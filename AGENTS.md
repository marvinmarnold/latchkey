# Latchkey — Agentic Context

## What this project is

A crypto-native LLM proxy. One endpoint, one wallet, every model. Callers sign with an EVM private key, pre-fund USDC on Base, and make standard OpenAI/Anthropic API calls. The proxy routes to the cheapest provider and logs billing on-chain.

## Live endpoints

- **Proxy:** `https://api.latchkey.me` (Bun/Elysia on Servury VPS, `root@151.247.22.152`)
- **Admin:** `https://payprompt-admin.vercel.app` (Next.js on Vercel, project `payprompt-admin`)
- **GitHub:** `git@github.com:marvinmarnold/latchkey.git` — active branch `ma/3`

## How to use the proxy as Claude Code

```bash
source .env.client   # sets ANTHROPIC_BASE_URL=https://api.latchkey.me and ANTHROPIC_API_KEY=<token>
claude
```

Token in `.env.client` expires 2026-06-30. Regenerate:
```bash
cd packages/proxy
~/.bun/bin/bun -e "import{encodeBearerToken}from'./src/middleware/auth.ts'; process.stdout.write(await encodeBearerToken('$(grep TEST_PRIVATE_KEY packages/proxy/.env | cut -d= -f2)', Math.floor(Date.now()/1000)+30*86400))"
```

## Phase status

| Phase | Status | Gating condition |
|-------|--------|-----------------|
| 1 — Proxy | ✅ live | — |
| 2 — On-chain balance | 🔲 next | Contract deployed, proxy not wired |
| 3 — zkTLS | 🔲 stub | No prover library available |
| 4 — Fingerprinting | ✅ running | No enforcement until phase 2 |
| 5 — Solana | 🔲 disabled | Re-enable in `middleware/auth.ts` |

## Deploy workflow

```bash
# 1. Code change → push
git push origin ma/3

# 2. Pull on server + restart
ssh -i ~/.ssh/id_ed25519 root@151.247.22.152 \
  "cd /root/latchkey && git pull origin ma/3 && /root/.bun/bin/bun install --frozen-lockfile && systemctl restart latchkey-proxy"

# 3. ALWAYS sync env after a deploy (prevents stale BALANCE_CONTRACT_ADDRESS)
bash deploy/sync-env.sh

# 4. Verify with E2E billing loop test
cd packages/e2e
E2E_PROXY_URL=https://api.latchkey.me \
E2E_ADMIN_URL=https://payprompt-admin.vercel.app \
E2E_BEARER_TOKEN=<fresh token> \
npx playwright test
```

## Critical invariant: BALANCE_CONTRACT_ADDRESS must be empty in phase 1

If it has a value, all requests return 402. `deploy/sync-env.sh` reads from local `.env` which has it empty. Never set it on the server until the funding flow is tested end-to-end.

## Wallet / credentials

- **Private key:** in `packages/proxy/.env` as `TEST_PRIVATE_KEY`
- **EVM address:** `0xe65710F012F0Dc625c85Cd50Cb1b0A1e9E63Eb89`
- **Client env file:** `.env.client` (gitignored)
- **Server SSH:** `ssh -i ~/.ssh/id_ed25519 root@151.247.22.152` (passwordless)

## Running E2E tests

```bash
# Local (12 tests, full billing loop, no credentials needed):
cd packages/e2e && npx playwright test

# Production (9 pass, 3 skip):
E2E_PROXY_URL=https://api.latchkey.me \
E2E_ADMIN_URL=https://payprompt-admin.vercel.app \
E2E_BEARER_TOKEN=<token> \
npx playwright test
```
