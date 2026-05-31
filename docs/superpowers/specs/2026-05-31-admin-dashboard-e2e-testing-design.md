# Admin Dashboard & E2E Testing Design

## Goal

Two deliverables to close out Phase 1:

1. **E2E testing runbook** — a documented procedure for pointing Claude Code at `api.latchkey.me` and confirming the full request path works (auth → routing → billing).
2. **Admin dashboard** — a standalone Next.js app deployed on Vercel that shows token usage over time, broken down by wallet, provider, and model.

---

## Proxy changes — `GET /admin/usage`

A single new unauthenticated route added to the existing Elysia app in `packages/proxy/src/index.ts`.

**Three SQL queries** against `billing_log`, each grouped by `date(datetime(created_at, 'unixepoch'))` + a series dimension, filtered to the last 30 days:

- By wallet: group by `caller_address`
- By provider: group by `provider_id`
- By model: group by `hf_repo_id`

In all three, `tokens = input_tokens + output_tokens`.

**Response shape:**
```json
{
  "byWallet":   [{ "date": "2026-05-29", "key": "0xabc…", "tokens": 1240 }],
  "byProvider": [{ "date": "2026-05-29", "key": "deepseek-v3-01", "tokens": 1240 }],
  "byModel":    [{ "date": "2026-05-29", "key": "deepseek-ai/DeepSeek-V3", "tokens": 1240 }]
}
```

**CORS:** Add `Access-Control-Allow-Origin: *` header on the `/admin/usage` route only. The route is unauthenticated and read-only, so open CORS is acceptable.

**No new file** — the route is added directly to the existing `buildApp()` function in `src/index.ts`.

---

## Admin app — `packages/admin`

A new Next.js app in the monorepo. Deployed to Vercel.

### Structure

```
packages/admin/
  package.json
  next.config.ts
  .env.local.example       ← documents NEXT_PUBLIC_PROXY_URL
  app/
    layout.tsx
    page.tsx               ← fetches /admin/usage, renders three UsageChart components
  components/
    UsageChart.tsx         ← reusable chart: pivots flat rows, renders Recharts LineChart
```

### Data flow

`page.tsx` fetches `${NEXT_PUBLIC_PROXY_URL}/admin/usage` client-side on mount (`useEffect` + `fetch`). No SSR. Passes the three arrays to three `<UsageChart>` instances.

### `UsageChart` component

Props: `title: string`, `rows: { date: string; key: string; tokens: number }[]`

Internally pivots rows into Recharts format: an array of `{ date, [seriesKey]: tokens }` objects, one per date. Renders a `<LineChart>` with one `<Line>` per unique `key` value. X-axis is date string, Y-axis is token count.

### Charts

| # | Title | Series |
|---|-------|--------|
| 1 | Tokens by Wallet | `caller_address` |
| 2 | Tokens by Provider | `provider_id` |
| 3 | Tokens by Model | `hf_repo_id` |

Time range: last 30 days, daily buckets.

### Environment variable

`NEXT_PUBLIC_PROXY_URL=https://api.latchkey.me` — set in Vercel dashboard and in `.env.local` for local dev.

### Deployment

Standard `vercel` deploy from `packages/admin`. No build customisation needed beyond `next.config.ts` pointing the root at the package directory.

---

## E2E testing runbook

Documents how to verify the full request path works. Lives as a section in the project README.

### Steps

1. **Generate a bearer token** from your wallet private key:
   ```bash
   cd packages/proxy
   bun -e "import { encodeBearerToken } from './src/middleware/auth.ts'; console.log(await encodeBearerToken('0xYOUR_PRIVATE_KEY'))"
   ```

2. **Point Claude Code at the proxy:**
   ```bash
   export ANTHROPIC_BASE_URL=https://api.latchkey.me
   export ANTHROPIC_API_KEY=<token from step 1>
   claude
   ```

3. **Verify model routing** — Claude Code sends requests with Anthropic model IDs (e.g. `claude-sonnet-4-6`). The proxy routes by matching the `model` field against `hf_repo_id` in the providers table. During implementation, check `seedProviders()` in `packages/proxy/src/db.ts` and confirm a row exists with `hf_repo_id = 'claude-sonnet-4-6'` (or whichever model Claude Code defaults to). If not, add a seed row pointing at Anthropic's API before testing.

4. **Confirm on the admin dashboard** — after making a request in Claude Code, the admin dashboard should show a new data point for your wallet address. This closes the verification loop: auth → routing → billing → visibility.

### Success criteria

- Claude Code sends a message and receives a coherent response (not a 4xx error)
- The admin dashboard shows the request reflected in the "Tokens by Wallet" chart within the same day

---

## What this is not

- No authentication on the admin dashboard (intentional — internal tool only)
- No real-time updates — page reload to refresh
- No cost display — tokens only (cost data is in `billing_log.cost_usdc` but not surfaced in v1)
- No pagination or filtering beyond the 30-day window
