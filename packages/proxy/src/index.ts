import { Elysia, status } from 'elysia'
import type { Database } from 'bun:sqlite'
import { openDb, seedProviders } from './db'
import { verifyBearerToken, extractTokenFromRequest } from './middleware/auth'
import { assertSufficientBalance, readUsdcAllowance } from './middleware/balance'
import { normaliseAnthropicToOpenAI } from './format/normalise'
import { translateOpenAIToAnthropic, openAIStreamToAnthropicStream } from './format/translate'
import { selectListing, penaliseListing } from './router'
import { forwardToProvider } from './forwarder'
import { discoverModels } from './discovery'
import { extractUsageFromStream, extractUsageFromAnthropicStream, computeCost, logUsage } from './billing'
import { enqueueProofJob, startProofWorker } from './zktls'
import { fingerprintAllListings, startFingerprintWorker } from './fingerprint'
import { queryUsage, queryWallets, queryAllowance } from './admin'
import { accrue, assertWalletAllowed } from './wallet'
import { startPullWorker } from './puller'
import { makePullChain } from './pullchain'
import { PULL_SCALE, PULL_THRESHOLD_USD, PULL_THRESHOLD_ATOMIC } from './config'
import type { AnthropicRequest, OpenAIRequest, OpenAIResponse } from './types'

/**
 * Convert an upstream provider error to the appropriate HTTP status.
 * Rate-limit (429) and overload (529) are passed through verbatim so clients
 * (e.g. Claude Code) can honour Retry-After and back off correctly instead of
 * seeing a generic 502 and retrying aggressively.
 * Only genuine provider failures (5xx other than 529) penalise the listing.
 */
function handleUpstreamError(
  e: unknown,
  db: ReturnType<typeof import('./db').openDb>,
  listingId: string,
): Response {
  const upstreamStatus = (e as { statusCode?: number }).statusCode
  const msg = e instanceof Error ? e.message : 'Provider error'

  // Rate-limit and overload: pass status through, do NOT penalise.
  // Also forward Retry-After so clients (e.g. Claude Code) know exactly how long to wait.
  if (upstreamStatus === 429 || upstreamStatus === 529) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const retryAfter = (e as { retryAfter?: string | null }).retryAfter
    if (retryAfter) headers['Retry-After'] = retryAfter
    return new Response(
      JSON.stringify({ error: { type: 'rate_limit_error', message: msg } }),
      { status: upstreamStatus, headers },
    )
  }

  // Genuine provider failure: penalise reliability and return 502.
  penaliseListing(db, listingId)
  return new Response(
    JSON.stringify({ error: { type: 'api_error', message: msg } }),
    { status: 502, headers: { 'Content-Type': 'application/json' } },
  )
}

// Phase 2 pull config — single source of truth lives in ./config.
// BILLING_CONTRACT_ADDRESS is still re-read per-request (below) so test env overrides take effect.

export function buildApp(db: Database) {
  const app = new Elysia()
    .get('/health', () => ({ status: 'ok', version: '0.1.0' }))
    .get('/admin/usage', ({ set }) => {
      set.headers['Access-Control-Allow-Origin'] = '*'
      return queryUsage(db)
    })
    .get('/admin/wallets', ({ set }) => {
      set.headers['Access-Control-Allow-Origin'] = '*'
      return queryWallets(db)
    })
    .get('/admin/allowance/:address', async ({ params, set }) => {
      set.headers['Access-Control-Allow-Origin'] = '*'
      return queryAllowance(params.address)
    })

  const api = new Elysia()
    .resolve(async ({ request }) => {
      const encoded = extractTokenFromRequest(request)
      if (!encoded) return status(401, { error: { type: 'authentication_error', message: 'Missing token' } })
      try {
        const { callerAddress, chain } = await verifyBearerToken(encoded)
        // Read at request time so test env overrides take effect.
        const billingContract = process.env.BILLING_CONTRACT_ADDRESS || ''
        if (billingContract && chain !== 'solana') {
          // Phase 2: EVM wallets only — RPC-free blocked check + first-seen allowance gate.
          // Solana wallets skip this and fall through to mock mode below (Phase 5: on-chain
          // Solana billing is not yet wired; usage is still accrued for dashboard visibility).
          await assertWalletAllowed(db, callerAddress, {
            readAllowance: (a) => readUsdcAllowance(a, billingContract),
            thresholdAtomic: PULL_THRESHOLD_ATOMIC,
          })
        } else {
          // Phase 1 mock mode (EVM without billing contract) or any Solana wallet.
          await assertSufficientBalance(callerAddress, chain)
        }
        return { callerAddress }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Invalid token'
        const httpStatus = (e as { statusCode?: number }).statusCode === 402 ? 402 : 401
        return status(httpStatus, { error: { type: 'authentication_error', message: msg } })
      }
    })

    .post('/v1/chat/completions', async ({ body, callerAddress, set }) => {
      const req = body as OpenAIRequest
      const listing = selectListing(db, req.model)
      if (!listing) return status(404, { error: { type: 'not_found_error', message: `No provider for model: ${req.model}` } })
      try {
        const { stream, json, isStreaming } = await forwardToProvider(listing, req, req.model)
        if (isStreaming && stream) {
          const providerHost = new URL(listing.endpoint).hostname
          let billed = false // guard: providers may emit multiple usage events; bill only once
          const { stream: billedStream } = extractUsageFromStream(stream, usage => {
            if (billed) return
            billed = true
            const cost = computeCost(usage.prompt_tokens, usage.completion_tokens, listing.price_input_usd_per_million, listing.price_output_usd_per_million)
            const { id } = logUsage(db, { callerAddress, listingId: listing.id, modelId: req.model, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, costUsd: cost })
            accrue(db, callerAddress, cost)
            try { enqueueProofJob(db, { billingLogId: id, callerAddress, providerHost, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }) } catch { /* non-fatal */ }
          })
          set.headers['Content-Type'] = 'text/event-stream'
          set.headers['Cache-Control'] = 'no-cache'
          set.headers['Connection'] = 'keep-alive'
          return new Response(billedStream)
        }
        const oaiRes = json as OpenAIResponse
        const cost = computeCost(oaiRes.usage.prompt_tokens, oaiRes.usage.completion_tokens, listing.price_input_usd_per_million, listing.price_output_usd_per_million)
        const { id: billingId1 } = logUsage(db, { callerAddress, listingId: listing.id, modelId: req.model, inputTokens: oaiRes.usage.prompt_tokens, outputTokens: oaiRes.usage.completion_tokens, costUsd: cost })
        accrue(db, callerAddress, cost)
        try { enqueueProofJob(db, { billingLogId: billingId1, callerAddress, providerHost: new URL(listing.endpoint).hostname, inputTokens: oaiRes.usage.prompt_tokens, outputTokens: oaiRes.usage.completion_tokens }) } catch { /* non-fatal */ }
        return oaiRes
      } catch (e: unknown) {
        return handleUpstreamError(e, db, listing.id)
      }
    })

    .post('/v1/messages', async ({ body, callerAddress, set }) => {
      const req = body as AnthropicRequest
      const openAIReq = normaliseAnthropicToOpenAI(req)
      const listing = selectListing(db, req.model)
      if (!listing) return status(404, { error: { type: 'not_found_error', message: `No provider for model: ${req.model}` } })
      try {
        const { stream, json, isStreaming } = await forwardToProvider(listing, openAIReq, req.model)
        const msgProviderHost = new URL(listing.endpoint).hostname
        if (isStreaming && stream) {
          let msgBilled = false
          const onUsage = (usage: { prompt_tokens: number; completion_tokens: number }) => {
            if (msgBilled) return
            msgBilled = true
            const cost = computeCost(usage.prompt_tokens, usage.completion_tokens, listing.price_input_usd_per_million, listing.price_output_usd_per_million)
            const { id } = logUsage(db, { callerAddress, listingId: listing.id, modelId: req.model, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, costUsd: cost })
            accrue(db, callerAddress, cost)
            try { enqueueProofJob(db, { billingLogId: id, callerAddress, providerHost: msgProviderHost, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }) } catch { /* non-fatal */ }
          }
          // Anthropic upstream: stream is already Anthropic SSE — pass through unchanged.
          // OpenAI upstream: extract OpenAI-format usage and convert to Anthropic SSE.
          let responseStream: ReadableStream<Uint8Array>
          if (listing.upstream_format === 'anthropic') {
            const { stream: billedStream } = extractUsageFromAnthropicStream(stream, onUsage)
            responseStream = billedStream
          } else {
            const { stream: billedStream } = extractUsageFromStream(stream, onUsage)
            responseStream = openAIStreamToAnthropicStream(billedStream)
          }
          set.headers['Content-Type'] = 'text/event-stream'
          set.headers['Cache-Control'] = 'no-cache'
          set.headers['Connection'] = 'keep-alive'
          return new Response(responseStream)
        }
        const oaiRes = json as OpenAIResponse
        const cost = computeCost(oaiRes.usage.prompt_tokens, oaiRes.usage.completion_tokens, listing.price_input_usd_per_million, listing.price_output_usd_per_million)
        const { id: billingId2 } = logUsage(db, { callerAddress, listingId: listing.id, modelId: req.model, inputTokens: oaiRes.usage.prompt_tokens, outputTokens: oaiRes.usage.completion_tokens, costUsd: cost })
        accrue(db, callerAddress, cost)
        try { enqueueProofJob(db, { billingLogId: billingId2, callerAddress, providerHost: msgProviderHost, inputTokens: oaiRes.usage.prompt_tokens, outputTokens: oaiRes.usage.completion_tokens }) } catch { /* non-fatal */ }
        return translateOpenAIToAnthropic(oaiRes)
      } catch (e: unknown) {
        return handleUpstreamError(e, db, listing.id)
      }
    })

  return app.use(api)
}

// Entry point
if (import.meta.main) {
  const db = openDb()
  seedProviders(db)
  const PORT = Number(process.env.PORT ?? 3000)
  const server = buildApp(db).listen(PORT)
  console.log(`Latchkey proxy running on http://localhost:${PORT}`)
  // Discover models in the background — don't block accepting traffic
  discoverModels(db).then(
    () => console.log('[discovery] complete'),
    (e) => console.warn('[discovery]', (e as Error).message),
  )
  // Phase 3: zkTLS proof worker (stub — no prover connected yet)
  startProofWorker(db)
  // Phase 4: model fingerprinting — baseline on startup, re-check every 6 hours
  fingerprintAllListings(db).then(
    () => console.log('[fingerprint] baseline complete'),
    (e) => console.warn('[fingerprint]', (e as Error).message),
  )
  startFingerprintWorker(db)
  // Phase 2: pull-payment worker — only when a billing contract + signer are configured.
  const billingContractAtStartup = process.env.BILLING_CONTRACT_ADDRESS || ''
  if (billingContractAtStartup && process.env.PROXY_PRIVATE_KEY) {
    const chain = makePullChain({
      billingContract: billingContractAtStartup as `0x${string}`,
      proxyPrivateKey: process.env.PROXY_PRIVATE_KEY as `0x${string}`,
      rpcUrl: process.env.BASE_RPC_URL ?? 'https://sepolia.base.org',
    })
    startPullWorker(db, chain, { thresholdUsd: PULL_THRESHOLD_USD, scale: PULL_SCALE })
    console.log(`[puller] pull-payment worker started (threshold $${PULL_THRESHOLD_USD}, contract ${billingContractAtStartup})`)
  } else {
    console.log('[puller] disabled — BILLING_CONTRACT_ADDRESS/PROXY_PRIVATE_KEY not set (Phase 1 mock mode)')
  }
  // Phase 5: Solana auth is active. Billing is mock by default — all Solana wallets get
  // a synthetic 1000 USDC balance and pay nothing. This is intentional while the Solana
  // billing program is not yet deployed. Set SOLANA_BILLING_ENABLED=true ONLY when the
  // on-chain program is live; otherwise Solana usage is unmetered.
  if (process.env.SOLANA_BILLING_ENABLED !== 'true') {
    console.warn('[solana] WARNING: billing is in mock mode — Solana callers pay nothing. Set SOLANA_BILLING_ENABLED=true to enforce real SPL balance checks.')
  }
}
