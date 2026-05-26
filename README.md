# Payprompt LLM Marketplace — Proxy

An HTTP proxy that lets agents and developers call open-weight LLMs through a single endpoint, with wallet-based auth and per-request billing. Providers compete on price; the proxy routes to the cheapest available one.

## How it works

```
Caller (agent / developer)
  │  Authorization: Bearer <EIP-712 signed token>
  ▼
Proxy  ──► auth + balance check
       ──► select cheapest provider for the requested model
       ──► forward request (OpenAI format) to provider endpoint
       ──► stream response back, extract token usage, log cost to SQLite
```

- **Callers** authenticate with a signed EIP-712 `BearerToken` (no registration, no gas — just sign a `{address, expiry, nonce}` struct with your wallet).
- **Providers** are open-weight model endpoints (self-hosted vLLM/Ollama or API-delegating services like DeepSeek/Together). Proprietary models (OpenAI, Anthropic, Google) are excluded.
- **Billing** is logged to SQLite in micro-USDC. On-chain settlement is mocked in v1 (balance check always passes); Phase 2 wires up Base RPC calls.

## API formats

The proxy accepts both OpenAI and Anthropic request shapes and normalises everything to OpenAI internally before forwarding.

| Endpoint | Format | Auth header |
|---|---|---|
| `POST /v1/chat/completions` | OpenAI | `Authorization: Bearer <token>` |
| `POST /v1/messages` | Anthropic | `x-api-key: <token>` |
| `GET /health` | — | none |

Models are identified by HF repo ID (e.g. `deepseek-ai/DeepSeek-V3`).

## Quick start

```bash
cp packages/proxy/.env.example packages/proxy/.env
# fill in BASE_RPC_URL if you want real on-chain balance checks

cd packages/proxy
bun install
bun run dev       # hot-reloads on file changes
```

The server starts on `http://localhost:3000`.

### Generating a bearer token

```ts
import { encodeBearerToken } from './packages/proxy/src/middleware/auth'

const token = await encodeBearerToken('0xYOUR_PRIVATE_KEY')
// pass as: Authorization: Bearer <token>
```

## Docker

```bash
DEEPSEEK_API_KEY=sk-... docker-compose up --build
```

The proxy listens on host port 3000. SQLite is persisted to the `proxy-data` named volume. `DEEPSEEK_API_KEY` is seeded into the providers table on first start; if you change it, destroy and recreate the volume (`docker-compose down -v`).

## Project layout

```
packages/proxy/
  src/
    index.ts          Elysia app + entry point
    db.ts             SQLite schema, migrations, provider seed
    router.ts         cheapest-provider selection, reliability scoring
    forwarder.ts      HTTP forwarding to provider endpoint
    billing.ts        token usage extraction from SSE stream, cost logging
    middleware/
      auth.ts         EIP-712 token verification (viem)
      balance.ts      on-chain balance check (mocked in v1)
    format/
      normalise.ts    Anthropic → OpenAI request translation
      translate.ts    OpenAI → Anthropic response translation
  test/               integration + unit tests (bun test)
deploy/               systemd unit, Caddyfile, deploy script for lnvps.net
Dockerfile            bun:alpine image, /app/data volume for SQLite
docker-compose.yml    single-service local deployment
```

## Stack

| Piece | Role |
|---|---|
| [Bun](https://bun.sh) | Runtime — TypeScript natively, built-in SQLite, fast HTTP |
| [Elysia](https://elysiajs.com) | HTTP framework built for Bun — routing, middleware via `.resolve()` |
| [viem](https://viem.sh) | EIP-712 typed-data signing and address recovery |
| SQLite (`bun:sqlite`) | Local billing log and provider registry |

## Running tests

```bash
cd packages/proxy
bun test
```

Integration tests in `test/integration.test.ts` hit real provider endpoints and require `DEEPSEEK_API_KEY` in the environment. Unit tests run without any env vars.
