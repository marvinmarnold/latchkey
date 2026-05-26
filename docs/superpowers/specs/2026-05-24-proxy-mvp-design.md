# Payprompt LLM Marketplace — Proxy MVP Design
**Date:** 2026-05-24
**Status:** Approved

---

## Team Summary

We're building a crypto-native LLM marketplace: one endpoint, one wallet, every open-weight model — no API keys.

**The problem:** Agents and developers juggle dozens of LLM API keys, have no spending controls, and are locked out of models behind credit cards. For AI agents operating autonomously, this is a blocker.

**Our solution:** A proxy that sits in front of any open-weight model provider. Callers authenticate with a wallet-signed token (no account, no signup), pre-fund a USDC balance on Base, and make standard OpenAI or Anthropic API calls. The proxy routes to the cheapest available provider, handles billing on-chain, and settles automatically.

**What makes it different:**
- Works with Claude Code, OpenAI Codex, Pi/DeepSeek — any tool that takes a base URL and API key
- Open-weight only — community runs inference (via vLLM, Ollama, or API services like DeepSeek/Groq), no TOS conflicts
- Providers get paid in USDC per token, no intermediary markup — 1% protocol fee at settlement
- API-delegating providers (those with a DeepSeek/Groq API key) get zkTLS proofs of every request — billing is verifiable, not trusted

**MVP focus:** Get the proxy working end-to-end — auth, routing, streaming, format translation. Smart contracts and zkTLS come in the next phase. Infrastructure can be deployed on crypto-native VPS ([lnvps.net](https://lnvps.net)) — pay for AI infra with crypto, no credit card required.

**Stack:** TypeScript, Bun, Elysia, SQLite, Base (EVM)

---

## Architecture

### Monorepo Structure

```
packages/
  proxy/       ← Elysia/Bun HTTP server (MVP)
  contracts/   ← Solidity contracts for Base (phase 2)
  sdk/         ← Caller-facing TypeScript client (phase 2)
```

### Proxy Pipeline

Every inbound request passes through a sequential middleware stack:

```
Caller request
  → Auth middleware        recover wallet address from EIP-712 Bearer Token
  → Balance middleware     check USDC balance on Base (mocked in MVP)
  → Format normaliser      Anthropic → OpenAI if needed
  → Router                 SQLite: cheapest active provider for HF model ID
  → Provider forwarder     stream request to provider endpoint
  → Format translator      OpenAI → Anthropic on the way back, if needed
  → Billing recorder       extract token usage from response, log to SQLite
  → [async] zkTLS prover   API-delegating providers only (phase 2)
Caller receives stream
```

### Endpoints

| Endpoint | API Format | Notes |
|---|---|---|
| `POST /v1/chat/completions` | OpenAI | Native passthrough |
| `POST /v1/messages` | Anthropic | Normalised → OpenAI internally, translated back on response |

---

## Data Model

### Provider Registry (SQLite)

```sql
providers (
  id            TEXT PRIMARY KEY,
  hf_repo_id    TEXT NOT NULL,      -- "deepseek-ai/DeepSeek-R1"
  endpoint      TEXT NOT NULL,      -- URL proxy forwards to
  type          TEXT NOT NULL,      -- "self_hosted" | "api_delegating"
  api_key_enc   TEXT,               -- encrypted; api_delegating only
  price_input   INTEGER NOT NULL,   -- USDC micro-units per 1M input tokens
  price_output  INTEGER NOT NULL,   -- USDC micro-units per 1M output tokens
  ctx_length    INTEGER,
  quantization  TEXT,
  reliability   REAL DEFAULT 1.0,   -- 0–1, updated after each request
  active        INTEGER DEFAULT 1
)
```

### Bearer Token

Callers paste this as the `api_key` in any OpenAI-compatible SDK. No other setup.

```ts
type BearerToken = {
  address: string   // EVM wallet address
  expiry:  number   // Unix timestamp
  nonce:   string   // Random — prevents replay
  sig:     string   // EIP-712 signature over {address, expiry, nonce}
}
// Encoded as base64(JSON.stringify(BearerToken))
```

Auth header accepted in both conventions:
- `Authorization: Bearer <token>` (OpenAI)
- `x-api-key: <token>` (Anthropic)

---

## MVP Scope

### In scope

| Component | Detail |
|---|---|
| Elysia HTTP server | `POST /v1/chat/completions`, `POST /v1/messages` |
| Bearer Token verification | EIP-712 signature recovery via `viem` |
| Balance check | Mocked — always passes; real check added in phase 2 |
| Format normalisation | Anthropic → OpenAI on the way in |
| Format translation | OpenAI → Anthropic on the way out |
| Router | SQLite query: cheapest active provider for requested HF model ID |
| Provider forwarder | Streaming SSE passthrough to provider endpoint |
| Billing recorder | Extracts `usage`, logs to SQLite (no on-chain debit yet) |
| SQLite seed data | 1–2 hardcoded providers for local testing |

### Out of scope (phase 2)

- Real USDC balance checks
- On-chain settlement and protocol fee routing
- zkTLS proof generation for API-delegating providers
- Provider staking and slashing
- Model fingerprinting and challenge sampling
- Provider self-registration flow
- Minimum stake amount
- Router v2 heuristics (latency, reliability scoring)

---

## Key Decisions (from CONTEXT.md)

- **Open-weight only** — HF repo ID is the canonical model identifier
- **No LiteLLM** — format translation built directly (supply chain attack, March 2026)
- **Bearer Token auth** — wallet-signed, no pre-registration, no gas
- **Cheapest-provider routing** in v1
- **Base (EVM)** for on-chain billing in v1; Solana added as second rail in v2
- **Per-token USDC pricing** — providers set input and output price separately
- **1% protocol fee** at settlement, taken at smart contract level
- **lnvps.net** — reference deployment target for AI infra (crypto-native VPS)

---

## Phase Sequence

| Phase | Focus |
|---|---|
| 1 — Proxy MVP | Auth, routing, streaming, format translation, SQLite registry |
| 2 — Contracts | USDC balance contract, protocol fee routing, provider staking |
| 3 — zkTLS | Async proof generation for API-delegating providers, on-chain settlement |
| 4 — Verification | Model fingerprinting at onboarding, periodic challenge sampling |
| 5 — Solana rail | Second funding chain, chain-agnostic balance abstraction |
