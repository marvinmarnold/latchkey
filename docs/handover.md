# Latchkey — Handover Document

_Generated 2026-06-01. Reflects the state of the codebase at the time of writing._

---

## What Was Built

### Phase 1 — Proxy Core
A Bun/Elysia HTTP proxy that:
- Accepts requests in both OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`) formats
- Normalises all inbound requests to OpenAI format internally, routes to the cheapest matching provider listing, and translates responses back to the caller's format
- Authenticates callers via a signed EVM bearer token (EIP-712 signature, no gas, no registration)
- Prefixes all tokens with `sk-ant-api03-` so Claude Code treats them as API keys and skips the login flow
- Logs usage (input/output tokens, cost in USD) to SQLite per request
- Exposes `/admin/usage` and `/admin/wallets` endpoints for the dashboard
- Deployed to `api.latchkey.me` (Base Sepolia) via systemd on a Servury VPS

### Phase 2 — Pull-Payment Billing
- `LatchkeyBilling.sol` deployed on Base Sepolia (`0x380ad468...`) — callers pre-approve a USDC allowance; the proxy pulls when accrued debt crosses the threshold ($0.10)
- Per-wallet state in SQLite (`wallet_state`): accrued debt, pull history, blocked flag
- Crash-safe background worker: records pending pull (amount + raw signed tx) before broadcasting so a crash never double-bills or loses a pull
- Admin dashboard (Next.js on Vercel) shows billing state, usage charts, and live USDC allowance per wallet

### Phase 3 — zkTLS (Stubbed)
Proof queue exists in SQLite (`tls_proof_queue`). Intentionally not connected to a prover — no production-ready zkTLS library exists for this use case as of mid-2026. Candidates when one becomes available: TLSNotary, Reclaim Protocol, zkPass. The proof must cover server identity and token counts without exposing the provider's API key.

### Phase 4 — Model Fingerprinting
On startup and every 6 hours, the proxy sends a deterministic probe prompt to every active listing and hashes the response. Mismatches are logged as warnings. The baseline is never overwritten on mismatch (the original hash is ground truth). Slashing on mismatch is future work (requires the staking contract).

### Phase 5 — Solana Auth Rail
- Ed25519 bearer token signing/verification added to `auth.ts`. Token format: `latchkey:{address}:{expiry}:{nonce}` signed by the caller's ed25519 private key; address is the base58 public key.
- Solana callers bypass the EVM allowance gate and run in mock billing mode. Usage is accrued in `billing_log` and the wallet table for dashboard visibility. On-chain SPL billing is gated behind `SOLANA_BILLING_ENABLED=true` (future phase — requires a deployed Solana program).
- 4 new Solana auth unit tests + 3 integration tests covering: round-trip verify, expired token, bad signature, spoofed address, EVM-gate bypass, usage accrual under correct Solana address.

---

## Providers

Two providers are seeded on every proxy startup from environment variables:

| Provider | ID | Listings | Env vars |
|---|---|---|---|
| **TwoShoes** | `twoshoes` | Anthropic (`claude-` prefix, upstream format `anthropic`), DeepSeek HF aliases (V3/V4-Pro/V4-Flash/R1), DeepSeek native prefix (`deepseek-`) | `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` |
| **BigThought** | `bigthought` | OpenAI (`gpt-` prefix), exact IDs for `o1/o1-mini/o1-pro/o3/o3-mini/o4-mini` | `OPENAI_API_KEY` |

All three keys live in `packages/proxy/.env` (gitignored). See `.env.example` for the full var list.

---

## Solana Key State

The proxy **only verifies** Solana tokens at request time — it does not hold a Solana private key.

Callers generate bearer tokens client-side using `encodeSolanaBearerToken(seed: Uint8Array)` from `packages/proxy/src/middleware/auth.ts`.

**Test keypair** (deterministic, used in unit tests):
- Seed: 32 bytes all `0x2a` — defined as `SOLANA_SEED = new Uint8Array(32).fill(42)` in `test/auth.test.ts`
- Public key (Solana address): `2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ`
- This seed is **not** in any env file — it lives in test source only

**Production use**: generate a real keypair with `solana-keygen new`. Put the public key in `SOLANA_TEST_PUBLIC_KEY` (synced to server for reference). Keep the secret key local — it belongs in the caller's env, not on the server.

---

## Open Questions

| Question | Notes |
|---|---|
| zkTLS library | No production-ready option as of mid-2026. Revisit when TLSNotary or Reclaim Protocol reaches v1.0. |
| Solana on-chain billing | Requires a deployed Solana program (SPL escrow / pull-payment). Significant work; billing is in mock mode. |
| Nonce replay protection | Both EVM and Solana bearer tokens are replayable until expiry. A DB-backed nonce store with TTL would close this. Low risk at current scale; high priority at scale. |
| Fingerprint slashing | Phase 4 logs mismatches but does not slash. Requires the staking contract (Phase D below). |
| Provider discovery | `discoverModels()` runs at startup and populates model metadata from upstream APIs. Not yet deeply integrated into routing logic. |

---

## Follow-Up Roadmap

### Security Review (immediate)

Before any public launch, a focused security review should cover:

- **Nonce replay** — bearer tokens valid until expiry can be replayed. Mitigate with a short-TTL nonce store in SQLite (add `used_nonces` table, expire after `expiry` timestamp).
- **Admin endpoint auth** — `/admin/usage`, `/admin/wallets`, `/admin/allowance/:address` are unauthenticated. Add a shared secret or JWT gate before exposing to the public internet.
- **EVM signature malleability** — EIP-712 via viem is robust, but confirm `recovered.toLowerCase() === token.address.toLowerCase()` is sufficient (currently correct).
- **SQLite WAL + crash safety** — review the pull worker's pending-pull state machine under concurrent restarts.
- **Rate limiting** — no per-wallet or per-IP rate limit on the proxy. Easy DoS vector.
- **Dependency audit** — run `bun audit` or `npm audit`; `@solana/web3.js` is a large dependency with historical supply chain incidents.

---

### Phase A — Cloud Dev Server (MVP)

A one-command isolated development environment, paid in crypto, with everything pre-installed.

**Goal**: a developer runs one command and gets a full remote IDE (Claude Code + EVM wallet) on a fresh VPS they pay for with crypto.

**VPS options** (need programmatic API + crypto payment):
- **LNVPS** — Lightning Network payments, API-driven provisioning. Best fit for Lightning/Bitcoin-native users.
- **Servure** — already in use for `api.latchkey.me`, accepts crypto. Investigate their provisioning API.
- **Hetzner / DigitalOcean + BTCPay** — mainstream VPS + BTCPay overlay; more complex but more reliable at scale.

**MVP stack (Phase A1)**:
- Provision VPS via API (provider TBD)
- Bootstrap script installs: Claude Code CLI, Bun, Node, Git
- Generate a fresh EVM wallet on first boot; print private key + address to console (user overwrites with their own via env)
- Expose SSH access; provide connection string
- Latchkey bearer token pre-seeded from generated wallet

**Full stack (Phase A2)**:
- Add Cursor, Codex (OpenAI CLI), Ghostty terminal
- VNC server (TigerVNC or noVNC browser-based) for remote GUI
- Generate Solana wallet alongside EVM wallet
- GitHub SSH key setup wizard
- Tie VPS payment into Latchkey billing (VPS runtime cost billed per-minute via Latchkey pull-payment)

---

### Phase B — Admin → Full Caller App

Convert `packages/admin` from an internal ops dashboard into the public-facing caller product.

**Phase B1 — Landing page**
- Marketing copy: what Latchkey is, pricing table (pull from live listings), getting-started CTA
- No auth required

**Phase B2 — Sign Up / Connect Wallet**
- Wallet connect (wagmi + RainbowKit for EVM; Solana wallet adapter for Phantom/Backpack)
- On connect: derive the bearer token client-side (EIP-712 sign in browser) and display it as an API key (`sk-ant-api03-...`)
- Show pricing table for available models
- Show USDC allowance approval flow: how much to approve, link to Base scan, one-click approve via wagmi

**Phase B3 — Usage Dashboard (per-caller)**
- Authenticated view: show only the connected wallet's usage, costs, and pull history
- Charts: spend over time, tokens by model, cost breakdown

**Phase B4 — Stake & Slash (Providers + Users)**

This is the final integrity layer. Two mechanisms:

**Provider stake**:
- Providers deposit USDC stake before listing. Stake is held by the staking contract.
- If the fingerprint worker detects a model mismatch (Phase 4), it triggers a slash on-chain — stake is forfeited (partial or full).
- Admin UI: provider stake status, mismatch history, slash events.

**User stake / spending cap**:
- Users deposit stake (USDC) into the billing contract.
- The pull worker enforces: per-pull amount ≤ `min(userStake, $0.01)`. This caps exposure for users who have staked less.
- The billing contract enforces this constraint on-chain so the proxy cannot over-pull.
- UI: stake deposit flow, current cap, history.

---

## Key Files

| What | Where |
|---|---|
| Proxy entry | `packages/proxy/src/index.ts` |
| Auth (EVM + Solana) | `packages/proxy/src/middleware/auth.ts` |
| Provider + listing seed | `packages/proxy/src/db.ts` → `seedProviders()` |
| Billing pull worker | `packages/proxy/src/puller.ts` |
| zkTLS stub | `packages/proxy/src/zktls.ts` |
| Fingerprinting | `packages/proxy/src/fingerprint.ts` |
| Admin dashboard | `packages/admin/app/page.tsx` |
| E2E tests | `packages/e2e/tests/admin-dashboard.spec.ts` |
| Deploy script | `deploy/sync-env.sh` |
| Smart contract | `packages/contracts/` |
| Env template | `packages/proxy/.env.example` |

## Infrastructure

| Resource | Value |
|---|---|
| VPS | `root@151.247.22.152` — SSH via `~/.ssh/id_ed25519` |
| Server domain | `api.latchkey.me` (Cloudflare A record) |
| Admin URL | `https://payprompt-admin.vercel.app` |
| Vercel project | `payprompt-admin` under `geekyrocks` |
| GitHub repo | `git@github.com:marvinmarnold/latchkey.git` |
| Network | Base Sepolia (EVM) — USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Billing contract | `0x380ad468...` (Base Sepolia) |
