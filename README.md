# Latchkey

**One endpoint. One wallet. Every open-weight model.**

A crypto-native LLM marketplace proxy. Callers authenticate with a wallet signature instead of an API key, pre-fund a USDC balance on Base, and make standard OpenAI or Anthropic API calls. The proxy routes to the cheapest available provider, logs billing to SQLite, and settles on-chain.

Works out of the box with Claude Code, Cursor, the OpenAI SDK, and anything else that takes a base URL and an API key.

---

## What's built vs what's planned

### ✅ Phase 1 — Proxy (complete, deployed)

- EIP-712 wallet-signed bearer tokens — no accounts, no signup, no gas
- OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`) endpoints
- Format translation between both wire formats
- Cheapest-provider routing from a SQLite registry
- Provider discovery: queries `/v1/models` on startup, creates listings automatically
- Streaming SSE passthrough with token usage extraction
- Per-request billing logged to SQLite
- Admin dashboard: `GET /admin/usage` (30-day aggregates by wallet/provider/model) + Next.js frontend at `payprompt-admin.vercel.app`
- Playwright E2E test suite (12 tests, includes full billing loop verification)
- Deployed at `https://api.latchkey.me` — Bun + Caddy on Ubuntu VPS
- Seeded providers: Anthropic (`claude-` prefix), DeepSeek (HF repo IDs + `deepseek-` prefix), OpenAI (`gpt-` prefix + o-series)
- **Phase 1 mode:** `BALANCE_CONTRACT_ADDRESS` is empty — balance check is mocked (always passes). All valid EVM tokens get access. Intentional until phase 2 funding flow is live.
- **Known gaps (acceptable for single-operator use, addressed in phase 2):** unauthenticated admin endpoint, no rate limiting, plaintext provider API keys in SQLite.

### 🔲 Phase 2 — On-chain balance (next)

- Wire up `PaypromptBalance.sol` (already deployed at `0x9FDcd9DCe63e29575816c6fa9Df689a9F4566716` on Base Sepolia)
- Pre-request balance check: `balance - pending_debits >= estimated_cost`
- Deferred batch settlement (every 60s) with per-wallet credit limit and circuit breaker
- Per-wallet mutex to prevent concurrent over-spend
- Idempotency on `debit()` calls using billing_log row ID

### 🔲 Phase 3 — zkTLS proof (stub)

- `tls_proof_queue` table + background worker exist; no prover integrated
- Needed to prove API-delegating providers actually called the upstream
- Blocked on production-ready prover library (TLSNotary, Reclaim, zkPass all pre-production as of mid-2026)

### 🔲 Phase 4 — Model verification (running, no enforcement)

- Fingerprint probes run on startup and every 6h
- Logs response hash drift — no slashing until phase 2 contract is live

### 🔲 Phase 5 — Solana rail (disabled)

- Code exists, disabled in phase 1
- Re-enable in `middleware/auth.ts` when Solana funding flow is ready

---

## Quickstart (local dev)

**Prerequisites:** [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`)

```bash
git clone https://github.com/marvinmarnold/latchkey.git
cd latchkey
bun install

cp packages/proxy/.env.example packages/proxy/.env
# Edit packages/proxy/.env — fill in at least one of:
#   ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY

cd packages/proxy
bun run dev
# → Latchkey proxy running on http://localhost:3000
```

### Generate a bearer token

```bash
cd packages/proxy
bun -e "
import { encodeBearerToken } from './src/middleware/auth.ts'
const token = await encodeBearerToken('0xYOUR_PRIVATE_KEY')
console.log(token)
"
```

### Test it

```bash
curl http://localhost:3000/health

curl -s http://localhost:3000/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: <YOUR_TOKEN>' \
  -d '{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"Say hi."}],"max_tokens":20}'
```

### Use with Claude Code

```bash
source .env.client   # sets ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY
claude
```

### Run tests

```bash
cd packages/proxy && bun test

# E2E (local — spins up proxy + admin automatically):
cd packages/e2e && npx playwright test

# E2E (production):
cd packages/e2e
E2E_PROXY_URL=https://api.latchkey.me \
E2E_ADMIN_URL=https://payprompt-admin.vercel.app \
E2E_BEARER_TOKEN=<token> \
npx playwright test
```

---

## How requests flow

```
Caller (agent or developer)
  │  Authorization: Bearer <EIP-712 signed token>  or  x-api-key: <token>
  ▼
Proxy
  ├─ Verify token signature (viem EIP-712)
  ├─ Check balance           ← mocked phase 1; real contract phase 2
  ├─ Normalise format        ← Anthropic → OpenAI if needed
  ├─ Select listing          ← cheapest active listing for model (SQLite)
  ├─ Forward request         ← streaming SSE passthrough
  ├─ Translate response      ← OpenAI → Anthropic if needed
  └─ Log billing             ← extract token usage, write to SQLite
```

---

## Bearer token format

```ts
type BearerToken = {
  address: string  // EVM wallet address (0x...)
  expiry:  number  // Unix timestamp
  nonce:   string  // random hex
  sig:     string  // EIP-712 signature
}
// base64(JSON.stringify(token))
// Passed as: Authorization: Bearer <token>  (OpenAI format)
//        or: x-api-key: <token>             (Anthropic format)
```

---

## Project layout

```
packages/proxy/        Bun/Elysia proxy server
packages/admin/        Next.js admin dashboard (Vercel)
packages/e2e/          Playwright E2E tests
packages/contracts/    Solidity smart contracts (Foundry)
deploy/                Server deploy + sync scripts
```

## Stack

| | |
|---|---|
| **Runtime** | Bun — TypeScript natively, built-in SQLite |
| **HTTP** | Elysia — Bun-native framework |
| **Auth** | viem — EIP-712 signing and recovery |
| **Storage** | SQLite (`bun:sqlite`) |
| **Chain** | Base (EVM) — phase 2 onwards |
| **Admin** | Next.js 15 + Recharts on Vercel |
| **Reverse proxy** | Caddy — automatic HTTPS via Cloudflare DNS |
