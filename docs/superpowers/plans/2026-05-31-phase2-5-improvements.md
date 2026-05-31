# Phase 2-5 Architectural Improvements
> Captured from DeepSeek review session, 2026-05-31.
> These must be addressed when implementing the corresponding phase.

---

## Phase 2 — On-chain balance

### Must-fix before shipping phase 2

**1. Credit limit system (not just `> 0` check)**
Current plan checks `balances(address) > 0`. This is insufficient — a wallet with $0.01 could trigger a $10 request.
- Track `pending_debits` per wallet in SQLite
- Enforce: `on_chain_balance - pending_debits >= estimated_cost` before routing
- Estimate cost: `(input_token_limit * price_input) + (max_output_tokens * price_output)` — use the selected listing's prices, 1.5× safety margin
- Do NOT use `max(price_input, price_output) * (input + output)` — that double-counts

**2. Per-wallet mutex for concurrent requests**
Two simultaneous requests for the same wallet both pass the pre-check before either settles. Need optimistic locking or a per-wallet in-memory mutex on the `pending_debits` update.

**3. Idempotency on `debit()` calls**
Use `billing_log.id` as idempotency key. Log billing row before calling on-chain (`status = pending`), mark settled after confirmation. On startup, scan for `onchain_tx_hash IS NOT NULL AND settled = 0` and mark them settled (recovery from crash-after-confirmation).

**4. Batch settlement with circuit breaker**
- Settle every 60s
- If settlement fails 3× for a wallet, pause new requests for that wallet
- Pending debits older than 5 min auto-fail and are cleared (prevents stuck state after circuit breaker trips)

**5. `debit()` authorization**
Verify `onlyProxy` modifier is in `PaypromptBalance.sol`. Any address that can call `debit()` can drain all balances.

**6. Decimal precision**
- Base Sepolia USDC: 6 decimals
- `billing_log.cost_usdc` is in micro-USDC (integer). Document the conversion explicitly in code.
- Final formula: `on_chain_amount = cost_usdc / 1_000_000` (cost_usdc units → USDC 6-decimal units)

**7. Withdrawal timelock (5 min)**
Without it: deposit → spend → withdraw before settlement = free requests. Add per-user timelock in contract, not global.

**8. Fee only on success**
1% fee charged only when the proxy returns HTTP 200 with valid response. No debit on 5xx from upstream. Define "success" precisely for partial streaming: if stream was interrupted before completion, treat as failure.

### Acceptable risks for phase 2 (document, don't fix)

- **RPC oracle risk:** Use Alchemy/Infura with fallback, not public RPC. If stale data is returned, balance check may approve unfunded requests. Acceptable at low TVL.
- **Gas griefing / front-running:** Out of scope until higher TVL.
- **Plaintext API keys in SQLite:** Acceptable for single-operator. Address in phase 2 with an env-var-encrypted keys store.

---

## Phase 3 — zkTLS

No new architectural concerns. Current plan (async proof queue, background worker) is correct.

**Blocker:** No production-ready prover library as of mid-2026.
- Monitor: TLSNotary, Reclaim Protocol, zkPass
- When a library ships: replace `processProofQueue()` in `src/zktls.ts`
- The proof must cover: server TLS identity + response `usage.input_tokens` / `usage.output_tokens`, without revealing the provider API key

---

## Phase 4 — Model verification / enforcement

Currently logs hash drift, no enforcement. When phase 2 contract is live:
- Slashing: call `slash(providerId, amount)` on contract when fingerprint mismatch is confirmed
- Define confirmation threshold: N consecutive mismatches (not just one) before slashing
- Add challenge/appeal window for providers

---

## Phase 5 — Solana rail

Re-enable by restoring the Solana branch in `middleware/auth.ts`.

**Before re-enabling:**
- Understand why the unknown Solana address (`9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj`) appeared in the billing log in phase 1. Either an external scanner or a bug. Audit the auth flow before re-exposing.
- Add `SOLANA_ENABLED=true` env var gate (don't just uncomment the code)
- Solana balance check currently reads raw wallet USDC balance — Phase 5.5 is a proper Solana deposit program (mirrors `PaypromptBalance.sol`)

---

## Cross-cutting improvements (any phase)

- **Rate limiting:** Add per-wallet request cap (e.g., 100 req/min in-memory) before opening to public
- **Admin auth:** Add bearer token or IP restriction to `GET /admin/usage`
- **Model allowlist:** Discovery imports all models. Add an operator-configured allowlist to prevent accidental exposure of expensive/unwanted models
- **Upstream fallback:** If cheapest provider returns 5xx, retry next cheapest. Currently returns 502 immediately
- **Request timeout:** Enforce 30s timeout on upstream calls. Streaming connections can hang indefinitely
