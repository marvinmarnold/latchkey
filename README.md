# Payprompt

**One endpoint. One wallet. Every open-weight model.**

A crypto-native LLM marketplace proxy. Callers authenticate with a wallet signature instead of an API key, pre-fund a USDC balance on Base, and make standard OpenAI or Anthropic API calls. The proxy routes to the cheapest available provider, logs billing to SQLite, and will settle on-chain.

Works out of the box with Claude Code, Cursor, the OpenAI SDK, and anything else that takes a base URL and an API key.

---

## What's built vs what's planned

### ✅ Phase 1 — Proxy (complete, deployed)

- EIP-712 wallet-signed bearer tokens — no accounts, no signup, no gas
- OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`) endpoints
- Format translation between both wire formats (no LiteLLM)
- Cheapest-provider routing from a SQLite registry
- Streaming SSE passthrough with token usage extraction
- Per-request billing logged to SQLite
- Deployed at `https://api.latchkey.me` — Bun + Caddy on Ubuntu VPS
- Seeded providers: DeepSeek (OpenAI format), Anthropic, OpenAI

### ✅ Phase 2 — Smart contracts (deployed to Base Sepolia)

- `PaypromptBalance.sol` deployed at `0x9FDcd9DCe63e29575816c6fa9Df689a9F4566716` on Base Sepolia
- Callers deposit USDC into the contract; `balances(address)` is the real balance gate
- Real on-chain balance check via viem `readContract` in `middleware/balance.ts`
- 1% protocol fee to treasury (`0x1ECF3f51A771983C150b3cB4A2162E89c0A046Fc`) implemented in contract `debit()`
- **Pending**: per-request on-chain debit (adds latency — deferred to Phase 2.5 batch settlement)

### ✅ Phase 3 — zkTLS (stub implemented)

- `tls_proof_queue` SQLite table created; proof job enqueued after every request
- Background worker (`startProofWorker`) drains queue every 30s — currently logs intent only
- **Research gap**: no production-ready zkTLS library exists (TLSNotary, Reclaim Protocol, zkPass all pre-production). Proof generation estimated seconds–minutes; async settlement mandatory.
- When a prover is available: replace `processProofQueue()` in `src/zktls.ts`

### ✅ Phase 4 — Model verification (implemented)

- `model_fingerprints` SQLite table stores SHA-256 hashes of probe responses
- Probe sent at startup and every 6 hours to all active listings with API keys
- Logs warning on response hash drift (bait-and-switch detection)
- Slashing deferred until on-chain settlement is live

### ✅ Phase 5 — Solana rail (implemented)

- Bearer tokens now support both EVM (EIP-712) and Solana (ed25519) signatures
- Auto-detected by address format (`0x...` = EVM, base58 = Solana)
- Solana callers authenticated via `@noble/ed25519`; balance read directly from Solana wallet USDC
- Devnet USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- **Pending**: Solana on-chain program for deposits (Phase 5.5); current check reads raw wallet balance

---

## Quickstart (local dev)

**Prerequisites:** [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`)

```bash
git clone https://github.com/marvinmarnold/payprompt.git
cd payprompt
bun install

cp packages/proxy/.env.example packages/proxy/.env
# Edit packages/proxy/.env — fill in at least one of:
#   ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY

cd packages/proxy
bun run dev
# → Payprompt proxy running on http://localhost:3000
```

### Generate a bearer token

The proxy uses wallet-signed tokens instead of API keys. Generate one from any EVM private key:

```bash
cd packages/proxy
bun -e "
import { encodeBearerToken } from './src/middleware/auth.ts'
const token = await encodeBearerToken('0xYOUR_PRIVATE_KEY')
console.log(token)
"
```

Use any throwaway private key for local testing. Keep this token — it's your API key for all requests.

### Test it

```bash
# Health check (no auth needed)
curl http://localhost:3000/health

# OpenAI format
curl -s http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <YOUR_TOKEN>' \
  -d '{"model":"deepseek-ai/DeepSeek-V3","messages":[{"role":"user","content":"Say hi."}]}'

# Anthropic format
curl -s http://localhost:3000/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: <YOUR_TOKEN>' \
  -d '{"model":"deepseek-ai/DeepSeek-V3","messages":[{"role":"user","content":"Say hi."}],"max_tokens":50}'
```

### Use with Claude Code

```bash
export ANTHROPIC_BASE_URL=https://api.latchkey.me  # or http://localhost:3000 locally
export ANTHROPIC_API_KEY=<YOUR_TOKEN>
claude  # routes through the proxy
```

### Run tests

```bash
cd packages/proxy
bun test
```

---

## How requests flow

```
Caller (agent or developer)
  │  Authorization: Bearer <EIP-712 signed token>
  ▼
Proxy
  ├─ Verify token signature (viem, EIP-712)
  ├─ Check USDC balance  ← mocked in Phase 1, always passes
  ├─ Normalise format    ← Anthropic → OpenAI if needed
  ├─ Select provider     ← SQLite: cheapest active listing for model
  ├─ Forward request     ← streaming SSE passthrough
  ├─ Translate response  ← OpenAI → Anthropic if needed
  └─ Log billing         ← extract token usage, write to SQLite
```

---

## Bearer token format

Callers sign a structured EIP-712 message with their wallet private key — no gas, no on-chain transaction, no registration:

```ts
type BearerToken = {
  address: string  // EVM wallet address
  expiry:  number  // Unix timestamp — limits blast radius of a leaked token
  nonce:   string  // Random — prevents replay
  sig:     string  // EIP-712 signature over {address, expiry, nonce}
}
// Serialised as base64(JSON.stringify(token))
// Passed as: Authorization: Bearer <token>  (OpenAI)
//        or: x-api-key: <token>              (Anthropic)
```

---

## Provider registry

Providers are rows in SQLite. On startup, `seedProviders()` in `db.ts` inserts defaults based on env vars. The router selects the cheapest active listing for the requested model.

Two matching strategies per listing:
- **Exact** (`model_id`) — matches a specific HF repo ID like `deepseek-ai/DeepSeek-V3`
- **Prefix** (`model_prefix`) — matches anything starting with e.g. `claude-` or `gpt-`

Two provider types:
- **Self-hosted** — vLLM, Ollama, llama.cpp with an OpenAI-compatible endpoint
- **API-delegating** — holds a key for DeepSeek, Groq, Together, etc.

---

## Smart contract open questions

Phase 2 requires on-chain USDC balance tracking on Base. The architecture is sketched but **no contract code exists yet** and several design questions need answers before implementation:

**Balance contract**
- Does each caller get their own balance slot in a single shared contract, or a separate contract per caller?
- What's the withdrawal mechanism — immediate, or tiered with a delay to handle disputes?
- How does the proxy debit the balance? It currently runs off-chain with SQLite — do we do batched settlement or per-request?

**Protocol fee**
- 1% is the target. Does it route at settlement time via the contract, or does the proxy take a cut before forwarding to providers?

**Provider staking**
- What's the minimum stake amount? Needs modelling against realistic slash amounts.
- Is stake per-listing or per-provider?
- What's the unbonding period?

**zkTLS (Phase 3 — more research needed)**
- No production-ready zkTLS library exists for this use case as of early 2026.
- Closest projects: [TLSNotary](https://tlsnotary.org), [Reclaim Protocol](https://reclaimprotocol.org), [zkPass](https://zkpass.org).
- The proof has to cover: server identity (api.deepseek.com), response body (`usage.prompt_tokens`, `usage.completion_tokens`), without revealing the provider's API key.
- Proof generation is the bottleneck — current estimates are seconds to minutes per proof. Async settlement is mandatory.
- **This needs a research spike before Phase 3 can be planned.**

---

## Project layout

```
packages/proxy/
  src/
    index.ts              Elysia app + entry point
    db.ts                 SQLite schema, provider seed
    router.ts             cheapest-provider selection
    forwarder.ts          HTTP forwarding + SSE passthrough
    billing.ts            usage extraction, cost logging
    zktls.ts              Phase 3 — zkTLS proof queue + background worker
    fingerprint.ts        Phase 4 — model fingerprinting + drift detection
    middleware/
      auth.ts             EIP-712 (EVM) + ed25519 (Solana) token verify
      balance.ts          USDC balance check — EVM contract or Solana wallet
    format/
      normalise.ts        Anthropic → OpenAI request
      translate.ts        OpenAI → Anthropic response
  test/                   bun test suite
packages/contracts/
  src/
    PaypromptBalance.sol  Phase 2 — USDC deposit + 1% fee contract
  script/
    Deploy.s.sol          forge deploy script
  test/
    PaypromptBalance.t.sol  unit tests (forge)
deploy/
  deploy.sh               one-command deploy from local machine
  payprompt-proxy.service systemd unit
  Caddyfile               Caddy reverse proxy + HTTPS
  caddy.service           Caddy systemd unit
CONTEXT.md                domain glossary and architecture decisions
```

## Stack

| | |
|---|---|
| **Runtime** | [Bun](https://bun.sh) — TypeScript natively, built-in SQLite |
| **HTTP** | [Elysia](https://elysiajs.com) — Bun-native framework |
| **Auth** | [viem](https://viem.sh) — EIP-712 signing and recovery |
| **Storage** | SQLite (`bun:sqlite`) — provider registry and billing log |
| **Chain** | Base (EVM) — Phase 2 onwards |
| **Reverse proxy** | Caddy — automatic HTTPS via Cloudflare DNS challenge |
