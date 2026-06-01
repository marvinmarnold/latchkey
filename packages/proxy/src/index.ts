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
import { extractUsageFromStream, computeCost, logUsage } from './billing'
import { enqueueProofJob, startProofWorker } from './zktls'
import { fingerprintAllListings, startFingerprintWorker } from './fingerprint'
import { queryUsage, queryWallets, queryAllowance } from './admin'
import { accrue, assertWalletAllowed } from './wallet'
import { startPullWorker } from './puller'
import { makePullChain } from './pullchain'
import type { AnthropicRequest, OpenAIRequest, OpenAIResponse } from './types'

// Phase 2 pull-payment config. When BILLING_CONTRACT_ADDRESS is unset the proxy
// stays in Phase 1 mock mode: no allowance gate, no pulls (accrual still logged).
const BILLING_CONTRACT = process.env.BILLING_CONTRACT_ADDRESS || ''
const USDC_DECIMALS = Number(process.env.USDC_DECIMALS ?? 6)
const PULL_SCALE = 10 ** USDC_DECIMALS
const PULL_THRESHOLD_USD = Number(process.env.PULL_THRESHOLD_USD ?? 0.10)
const PULL_THRESHOLD_ATOMIC = BigInt(Math.round(PULL_THRESHOLD_USD * PULL_SCALE))

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
        if (BILLING_CONTRACT) {
          // Phase 2: RPC-free hot path — blocked check + first-seen allowance gate.
          await assertWalletAllowed(db, callerAddress, {
            readAllowance: (a) => readUsdcAllowance(a, BILLING_CONTRACT),
            thresholdAtomic: PULL_THRESHOLD_ATOMIC,
          })
        } else {
          // Phase 1 mock mode.
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
        penaliseListing(db, listing.id)
        return status(502, { error: { type: 'api_error', message: (e as Error).message } })
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
          const { stream: billedStream } = extractUsageFromStream(stream, usage => {
            if (msgBilled) return
            msgBilled = true
            const cost = computeCost(usage.prompt_tokens, usage.completion_tokens, listing.price_input_usd_per_million, listing.price_output_usd_per_million)
            const { id } = logUsage(db, { callerAddress, listingId: listing.id, modelId: req.model, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, costUsd: cost })
            accrue(db, callerAddress, cost)
            try { enqueueProofJob(db, { billingLogId: id, callerAddress, providerHost: msgProviderHost, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }) } catch { /* non-fatal */ }
          })
          const anthropicStream = openAIStreamToAnthropicStream(billedStream)
          set.headers['Content-Type'] = 'text/event-stream'
          set.headers['Cache-Control'] = 'no-cache'
          set.headers['Connection'] = 'keep-alive'
          return new Response(anthropicStream)
        }
        const oaiRes = json as OpenAIResponse
        const cost = computeCost(oaiRes.usage.prompt_tokens, oaiRes.usage.completion_tokens, listing.price_input_usd_per_million, listing.price_output_usd_per_million)
        const { id: billingId2 } = logUsage(db, { callerAddress, listingId: listing.id, modelId: req.model, inputTokens: oaiRes.usage.prompt_tokens, outputTokens: oaiRes.usage.completion_tokens, costUsd: cost })
        accrue(db, callerAddress, cost)
        try { enqueueProofJob(db, { billingLogId: billingId2, callerAddress, providerHost: msgProviderHost, inputTokens: oaiRes.usage.prompt_tokens, outputTokens: oaiRes.usage.completion_tokens }) } catch { /* non-fatal */ }
        return translateOpenAIToAnthropic(oaiRes)
      } catch (e: unknown) {
        penaliseListing(db, listing.id)
        return status(502, { error: { type: 'api_error', message: (e as Error).message } })
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
  if (BILLING_CONTRACT && process.env.PROXY_PRIVATE_KEY) {
    const chain = makePullChain({
      billingContract: BILLING_CONTRACT as `0x${string}`,
      proxyPrivateKey: process.env.PROXY_PRIVATE_KEY as `0x${string}`,
      rpcUrl: process.env.BASE_RPC_URL ?? 'https://sepolia.base.org',
    })
    startPullWorker(db, chain, { thresholdUsd: PULL_THRESHOLD_USD, scale: PULL_SCALE })
    console.log(`[puller] pull-payment worker started (threshold $${PULL_THRESHOLD_USD}, contract ${BILLING_CONTRACT})`)
  } else {
    console.log('[puller] disabled — BILLING_CONTRACT_ADDRESS/PROXY_PRIVATE_KEY not set (Phase 1 mock mode)')
  }
}
