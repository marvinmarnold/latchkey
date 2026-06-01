# Claude Instructions — Latchkey

## Review rule — always verify with DeepSeek before finishing a phase

Before declaring any phase of work done, call the DeepSeek API to review the implementation:
```bash
curl -s https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(grep DEEPSEEK_API_KEY packages/proxy/.env | cut -d= -f2)" \
  -d '{"model":"deepseek-chat","temperature":0.3,"messages":[{"role":"system","content":"You are a senior backend engineer. Be direct, flag real problems only."},{"role":"user","content":"<describe what was just built and ask for review>"}]}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'])"
```
Go back and forth until agreement is reached. Store any phase-specific improvements in `docs/superpowers/plans/`.

Do NOT add net-new features (encryption, retries, rate limits, security hardening) proactively. The priority is getting the core architecture right. These can be layered on later without refactoring.

---

## Deployment rules (read before every server change)

**After any `git pull + systemctl restart` on the server, always also run:**
```bash
bash deploy/sync-env.sh
```
Quick deploys do NOT rewrite the server `.env`. Stale values (especially `BALANCE_CONTRACT_ADDRESS`) will silently break requests. `sync-env.sh` reads `packages/proxy/.env` locally and writes it to the server over SSH.

**`BALANCE_CONTRACT_ADDRESS` must be empty in phase 1.** If it has a value, the proxy checks on-chain USDC balance, which returns 0 for any unfunded wallet → 402 → no billing → admin dashboard shows nothing. Phase 1 uses mock mode (always passes). Only set a contract address when the funding flow is tested end-to-end.

**Admin dashboard auto-refreshes every 30s** — but a manual reload always works too. If you just made requests and don't see them, wait 30s or reload.

**Verify a deploy worked:** after restarting the service, make a real request and confirm the billing log updated:
```bash
curl -sf https://api.latchkey.me/admin/usage | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['byWallet']), 'wallet entries')"
```

**Full production E2E** (run this after any proxy change):
```bash
cd packages/e2e
E2E_PROXY_URL=https://api.latchkey.me \
E2E_ADMIN_URL=https://payprompt-admin.vercel.app \
E2E_BEARER_TOKEN=$(cd ../proxy && ~/.bun/bin/bun -e "import{encodeBearerToken}from'./src/middleware/auth.ts';process.stdout.write(await encodeBearerToken('$(grep TEST_PRIVATE_KEY packages/proxy/.env | cut -d= -f2)'))") \
npx playwright test
```
The billing loop test (`Billing loop › a proxied request appears in /admin/usage`) makes a real POST and polls until billing is confirmed. If it fails, something in the auth→routing→billing chain is broken.

---

## Adding a new environment variable

All four steps are required for **app/provider vars** (API keys the proxy uses). Missing any one silently breaks something.

1. **`packages/proxy/src/db.ts`** — read it via `process.env.VAR ?? null` in `seedProviders()`
2. **`docker-compose.yml`** — add `VAR: ${VAR:-}` to the `environment` block
3. **`packages/proxy/.env.example`** — document it with an empty value (under the right section heading)
4. **`deploy/sync-env.sh`** — add the var to the heredoc so it's written to the server on every sync

**Exception — infrastructure-only vars** (e.g. `CLOUDFLARE_API_TOKEN`, `DEPLOY_PASSWORD`): skip steps 1 and 2. Only add to `.env.example` and handle in `deploy/deploy.sh` / `deploy/sync-env.sh`.

---

## Phase status

| Phase | Status | Notes |
|-------|--------|-------|
| 1 — Proxy | ✅ deployed, tested | EVM-only auth. `BALANCE_CONTRACT_ADDRESS=` (mock) |
| 2 — Smart contracts | ⚠ contract deployed, not wired | `PaypromptBalance.sol` on Base Sepolia. Balance check bypassed in phase 1 |
| 3 — zkTLS | 🔲 stub only | Proof queue exists; no prover integrated |
| 4 — Fingerprinting | ✅ running | Logs mismatches; no slashing yet |
| 5 — Solana rail | 🔲 disabled | Auth disabled phase 1. Re-enable in `middleware/auth.ts` |

---

## Key file locations

| What | Where |
|------|-------|
| Local credentials / API keys | `packages/proxy/.env` (gitignored) |
| Claude Code client token | `.env.client` (gitignored) |
| Server env sync script | `deploy/sync-env.sh` |
| E2E tests | `packages/e2e/` |
| Admin dashboard | `packages/admin/` → https://payprompt-admin.vercel.app |
| Proxy entry | `packages/proxy/src/index.ts` |
| Auth (EVM token verify) | `packages/proxy/src/middleware/auth.ts` |
| Balance check | `packages/proxy/src/middleware/balance.ts` |
