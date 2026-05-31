# Admin Dashboard & E2E Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `GET /admin/usage` endpoint to the proxy, build a Next.js dashboard on Vercel showing token usage over time by wallet/provider/model, and document the E2E testing runbook in the README.

**Architecture:** Three SQL queries against `billing_log` (joined to `listings`/`providers` for the provider series) are exposed via a single unauthenticated proxy route. A Next.js app fetches that endpoint client-side and renders three Recharts `LineChart` components — one per series dimension. The admin app lives in a new `packages/admin` monorepo package and deploys to Vercel with `Root Directory` set to `packages/admin`.

**Tech Stack:** TypeScript, Bun, Elysia (proxy), Next.js 15, React 19, Recharts, Vercel

---

## Schema reference (existing — do not change)

```
billing_log: id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usdc, created_at
listings:    id, provider_id, model_id, model_prefix, upstream_format, endpoint, api_key, ...
providers:   id, name, active
```

The join path for provider name: `billing_log.listing_id → listings.id → listings.provider_id → providers.id → providers.name`

Claude Code routing note: the `twoshoes-anthropic` listing already has `model_prefix = 'claude-'`, so any Claude Code model string (e.g. `claude-sonnet-4-6`) routes correctly via prefix match. No seed changes needed.

---

## File Map

```
packages/proxy/
  src/
    admin.ts                        ← new: queryUsage() — three SQL queries
    index.ts                        ← modify: add GET /admin/usage to buildApp()
  test/
    admin.test.ts                   ← new: unit + route tests

packages/admin/                     ← new Next.js package
  package.json
  tsconfig.json
  next.config.ts
  .env.local.example
  app/
    layout.tsx
    page.tsx                        ← fetches /admin/usage, renders three charts
  components/
    UsageChart.tsx                  ← pivots flat rows → Recharts LineChart

README.md                           ← modify: add E2E testing runbook section
```

---

## Task 1: Admin query module

**Files:**
- Create: `packages/proxy/src/admin.ts`
- Create: `packages/proxy/test/admin.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/proxy/test/admin.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { openDb, closeDb } from '../src/db'
import { queryUsage } from '../src/admin'
import type { Database } from 'bun:sqlite'

let db: Database

beforeEach(() => {
  db = openDb(':memory:')
  db.run(`INSERT INTO providers (id, name) VALUES ('p1', 'TestProvider')`)
  db.run(`
    INSERT INTO listings (id, provider_id, model_id, upstream_format, endpoint, price_input, price_output)
    VALUES ('l1', 'p1', 'test-model', 'openai', 'https://example.com', 100, 200)
  `)
  const now = Math.floor(Date.now() / 1000)
  // 0xabc: two requests today — 450 tokens total
  db.run(
    `INSERT INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usdc, created_at)
     VALUES ('b1', '0xabc', 'l1', 'test-model', 100, 50, 10, ?)`, [now],
  )
  db.run(
    `INSERT INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usdc, created_at)
     VALUES ('b2', '0xabc', 'l1', 'test-model', 200, 100, 20, ?)`, [now],
  )
  // 0xdef: one request today — 75 tokens total
  db.run(
    `INSERT INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usdc, created_at)
     VALUES ('b3', '0xdef', 'l1', 'test-model', 50, 25, 5, ?)`, [now],
  )
})

afterEach(() => closeDb(db))

describe('queryUsage', () => {
  it('byWallet groups by caller_address and sums tokens', () => {
    const { byWallet } = queryUsage(db)
    const abcRow = byWallet.find(r => r.key === '0xabc')
    const defRow = byWallet.find(r => r.key === '0xdef')
    expect(abcRow?.tokens).toBe(450)  // 100+50 + 200+100
    expect(defRow?.tokens).toBe(75)   // 50+25
  })

  it('byProvider groups by provider name', () => {
    const { byProvider } = queryUsage(db)
    const row = byProvider.find(r => r.key === 'TestProvider')
    expect(row?.tokens).toBe(525)     // all three requests, one provider
  })

  it('byModel groups by model_id', () => {
    const { byModel } = queryUsage(db)
    const row = byModel.find(r => r.key === 'test-model')
    expect(row?.tokens).toBe(525)
  })

  it('date field is YYYY-MM-DD format', () => {
    const { byWallet } = queryUsage(db)
    expect(byWallet[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('excludes rows older than 30 days', () => {
    const old = Math.floor(Date.now() / 1000) - 31 * 86400
    db.run(
      `INSERT INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usdc, created_at)
       VALUES ('b_old', '0xold', 'l1', 'test-model', 999, 999, 99, ?)`, [old],
    )
    const { byWallet } = queryUsage(db)
    expect(byWallet.find(r => r.key === '0xold')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/proxy && bun test test/admin.test.ts
```
Expected: FAIL — `Cannot find module '../src/admin'`

- [ ] **Step 3: Implement admin.ts**

```typescript
// packages/proxy/src/admin.ts
import type { Database } from 'bun:sqlite'

export type UsageRow = { date: string; key: string; tokens: number }

export type UsageResult = {
  byWallet: UsageRow[]
  byProvider: UsageRow[]
  byModel: UsageRow[]
}

export function queryUsage(db: Database): UsageResult {
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400

  const byWallet = db
    .query<UsageRow, [number]>(
      `SELECT date(datetime(created_at, 'unixepoch')) AS date,
              caller_address AS key,
              SUM(input_tokens + output_tokens) AS tokens
       FROM billing_log
       WHERE created_at >= ?
       GROUP BY date, caller_address
       ORDER BY date`,
    )
    .all(cutoff)

  const byProvider = db
    .query<UsageRow, [number]>(
      `SELECT date(datetime(bl.created_at, 'unixepoch')) AS date,
              p.name AS key,
              SUM(bl.input_tokens + bl.output_tokens) AS tokens
       FROM billing_log bl
       JOIN listings l ON l.id = bl.listing_id
       JOIN providers p ON p.id = l.provider_id
       WHERE bl.created_at >= ?
       GROUP BY date, p.name
       ORDER BY date`,
    )
    .all(cutoff)

  const byModel = db
    .query<UsageRow, [number]>(
      `SELECT date(datetime(created_at, 'unixepoch')) AS date,
              model_id AS key,
              SUM(input_tokens + output_tokens) AS tokens
       FROM billing_log
       WHERE created_at >= ?
       GROUP BY date, model_id
       ORDER BY date`,
    )
    .all(cutoff)

  return { byWallet, byProvider, byModel }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd packages/proxy && bun test test/admin.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/admin.ts packages/proxy/test/admin.test.ts
git commit -m "feat: admin usage query module — 30-day token aggregation by wallet, provider, model"
```

---

## Task 2: Proxy admin route

**Files:**
- Modify: `packages/proxy/src/index.ts`
- Modify: `packages/proxy/test/admin.test.ts` (append route test)

- [ ] **Step 1: Update the import line at the top of admin.test.ts**

Change the first line of `packages/proxy/test/admin.test.ts` from:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
```
to:
```typescript
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test'
```

- [ ] **Step 2: Append a route integration test to admin.test.ts**

Append to the bottom of `packages/proxy/test/admin.test.ts`:

```typescript
import { buildApp } from '../src/index'

const ADMIN_PORT = 19090

describe('GET /admin/usage', () => {
  let server: ReturnType<ReturnType<typeof buildApp>['listen']>

  beforeAll(() => {
    const testDb = openDb(':memory:')
    testDb.run(`INSERT INTO providers (id, name) VALUES ('p1', 'TestProvider')`)
    testDb.run(`
      INSERT INTO listings (id, provider_id, model_id, upstream_format, endpoint, price_input, price_output)
      VALUES ('l1', 'p1', 'test-model', 'openai', 'https://example.com', 100, 200)
    `)
    const now = Math.floor(Date.now() / 1000)
    testDb.run(
      `INSERT INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usdc, created_at)
       VALUES ('b1', '0xabc', 'l1', 'test-model', 100, 50, 10, ?)`, [now],
    )
    server = buildApp(testDb).listen(ADMIN_PORT)
  })

  afterAll(() => server?.stop())

  it('returns 200 with byWallet, byProvider, byModel arrays', async () => {
    const res = await fetch(`http://localhost:${ADMIN_PORT}/admin/usage`)
    expect(res.status).toBe(200)
    const json = await res.json() as { byWallet: unknown[]; byProvider: unknown[]; byModel: unknown[] }
    expect(Array.isArray(json.byWallet)).toBe(true)
    expect(Array.isArray(json.byProvider)).toBe(true)
    expect(Array.isArray(json.byModel)).toBe(true)
  })

  it('includes CORS header', async () => {
    const res = await fetch(`http://localhost:${ADMIN_PORT}/admin/usage`)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
```

Also add `beforeAll` and `afterAll` imports at the top of the file (they're already there via `beforeEach`/`afterEach` — add `beforeAll, afterAll` to the import):

```typescript
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test'
```

- [ ] **Step 2: Run to confirm the new tests fail**

```bash
cd packages/proxy && bun test test/admin.test.ts
```
Expected: FAIL — the route tests fail with connection refused.

- [ ] **Step 3: Add the route to buildApp() in src/index.ts**

In `packages/proxy/src/index.ts`, add the import at the top:

```typescript
import { queryUsage } from './admin'
```

Then, inside `buildApp()`, after the `.get('/health', ...)` line, add:

```typescript
    .get('/admin/usage', ({ set }) => {
      set.headers['Access-Control-Allow-Origin'] = '*'
      return queryUsage(db)
    })
```

The updated `buildApp` function opening should look like:

```typescript
export function buildApp(db: Database) {
  const app = new Elysia()
    .get('/health', () => ({ status: 'ok', version: '0.1.0' }))
    .get('/admin/usage', ({ set }) => {
      set.headers['Access-Control-Allow-Origin'] = '*'
      return queryUsage(db)
    })
  // ... rest unchanged
```

- [ ] **Step 4: Run all tests to confirm everything passes**

```bash
cd packages/proxy && bun test
```
Expected: PASS — all existing tests plus the new admin route tests.

- [ ] **Step 5: Commit**

```bash
git add packages/proxy/src/index.ts packages/proxy/test/admin.test.ts
git commit -m "feat: GET /admin/usage — unauthenticated usage endpoint with CORS"
```

---

## Task 3: Next.js admin app scaffold

**Files:**
- Create: `packages/admin/package.json`
- Create: `packages/admin/tsconfig.json`
- Create: `packages/admin/next.config.ts`
- Create: `packages/admin/.env.local.example`
- Create: `packages/admin/app/layout.tsx`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@payprompt/admin",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "recharts": "^2.13.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.0.0"
  }
}
```
Save to `packages/admin/package.json`.

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```
Save to `packages/admin/tsconfig.json`.

- [ ] **Step 3: Create next.config.ts**

```typescript
import type { NextConfig } from 'next'

const config: NextConfig = {}

export default config
```
Save to `packages/admin/next.config.ts`.

- [ ] **Step 4: Create .env.local.example**

```bash
NEXT_PUBLIC_PROXY_URL=https://api.latchkey.me
```
Save to `packages/admin/.env.local.example`.

Copy it for local dev:
```bash
cp packages/admin/.env.local.example packages/admin/.env.local
```

- [ ] **Step 5: Create app/layout.tsx**

```tsx
// packages/admin/app/layout.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Payprompt Admin' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', background: '#0f0f0f', color: '#e5e5e5' }}>
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 6: Install dependencies and confirm dev server starts**

```bash
cd packages/admin && npm install
npm run dev
```
Expected: Next.js dev server starts on http://localhost:3000. Hit Ctrl+C after confirming.

- [ ] **Step 7: Commit**

```bash
git add packages/admin/
git commit -m "feat: Next.js admin app scaffold"
```

---

## Task 4: UsageChart component

**Files:**
- Create: `packages/admin/components/UsageChart.tsx`

No dedicated test — correctness is verified visually in Task 5.

- [ ] **Step 1: Create UsageChart.tsx**

```tsx
// packages/admin/components/UsageChart.tsx
'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

export type UsageRow = { date: string; key: string; tokens: number }

const COLORS = ['#6366f1', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e', '#a78bfa', '#34d399']

function truncateKey(key: string): string {
  if (key.startsWith('0x') && key.length > 12) {
    return `${key.slice(0, 6)}…${key.slice(-4)}`
  }
  return key
}

function pivot(rows: UsageRow[]): Record<string, string | number>[] {
  const dates = [...new Set(rows.map(r => r.date))].sort()
  const keys = [...new Set(rows.map(r => r.key))]
  return dates.map(date => {
    const point: Record<string, string | number> = { date }
    for (const key of keys) {
      const row = rows.find(r => r.date === date && r.key === key)
      point[truncateKey(key)] = row?.tokens ?? 0
    }
    return point
  })
}

export default function UsageChart({ title, rows }: { title: string; rows: UsageRow[] }) {
  const data = pivot(rows)
  const keys = [...new Set(rows.map(r => truncateKey(r.key)))]

  return (
    <div style={{ marginBottom: '3rem' }}>
      <h2 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600, color: '#a3a3a3' }}>
        {title}
      </h2>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#737373' }} />
          <YAxis tick={{ fontSize: 11, fill: '#737373' }} />
          <Tooltip
            contentStyle={{ background: '#1c1c1c', border: '1px solid #333', borderRadius: 6 }}
            labelStyle={{ color: '#e5e5e5' }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#a3a3a3' }} />
          {keys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={COLORS[i % COLORS.length]}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/admin/components/UsageChart.tsx
git commit -m "feat: UsageChart component — Recharts LineChart with pivot and wallet address truncation"
```

---

## Task 5: Dashboard page

**Files:**
- Create: `packages/admin/app/page.tsx`

- [ ] **Step 1: Create page.tsx**

```tsx
// packages/admin/app/page.tsx
'use client'

import { useEffect, useState } from 'react'
import UsageChart, { type UsageRow } from '../components/UsageChart'

type UsageData = {
  byWallet: UsageRow[]
  byProvider: UsageRow[]
  byModel: UsageRow[]
}

export default function AdminPage() {
  const [data, setData] = useState<UsageData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const url = `${process.env.NEXT_PUBLIC_PROXY_URL ?? 'http://localhost:3000'}/admin/usage`
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<UsageData>
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '2.5rem' }}>
        Payprompt Usage — last 30 days
      </h1>

      {error && (
        <p style={{ color: '#f43f5e' }}>Failed to load: {error}</p>
      )}

      {!data && !error && (
        <p style={{ color: '#737373' }}>Loading…</p>
      )}

      {data && (
        <>
          <UsageChart title="Tokens by Wallet" rows={data.byWallet} />
          <UsageChart title="Tokens by Provider" rows={data.byProvider} />
          <UsageChart title="Tokens by Model" rows={data.byModel} />
        </>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Run dev server and verify the page loads**

```bash
cd packages/admin && npm run dev
```

Open http://localhost:3000. You should see "Loading…" while it fetches, then either the charts (if the proxy is running) or "Failed to load" with an error message. Either is correct — the page structure is working.

For charts to appear, the proxy must be running locally:
```bash
# In another terminal:
cd packages/proxy && bun run dev
```

Then reload http://localhost:3000. If `billing_log` is empty, the charts render with no lines (correct — no data yet).

- [ ] **Step 3: Commit**

```bash
git add packages/admin/app/page.tsx
git commit -m "feat: admin dashboard page — fetches /admin/usage and renders three usage charts"
```

---

## Task 6: README E2E testing runbook

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add E2E testing section to README.md**

Find the `## Quickstart (local dev)` section in `README.md`. Insert the following new section immediately after the quickstart section (before `## How requests flow`):

```markdown
## E2E testing with Claude Code

Verify the full request path (auth → routing → billing) by pointing Claude Code at the deployed proxy.

### 1. Generate a bearer token

```bash
cd packages/proxy
bun -e "
import { encodeBearerToken } from './src/middleware/auth.ts'
const token = await encodeBearerToken('0xYOUR_PRIVATE_KEY')
console.log(token)
"
```

Use a throwaway private key for testing. Keep the output — it's your API key.

### 2. Point Claude Code at the proxy

```bash
export ANTHROPIC_BASE_URL=https://api.latchkey.me
export ANTHROPIC_API_KEY=<token from step 1>
claude
```

### 3. Make a request

Send any message in Claude Code. It will route via the `twoshoes-anthropic` listing (prefix match on `claude-`), forwarding to Anthropic's API using the server's `ANTHROPIC_API_KEY`.

Your wallet address must have USDC deposited in the `PaypromptBalance` contract on Base Sepolia — the proxy checks on-chain balance before routing.

### 4. Confirm on the admin dashboard

After making a request, the admin dashboard at [admin.latchkey.me](https://admin.latchkey.me) (once deployed) should show a new data point for your wallet address in the "Tokens by Wallet" chart. This closes the verification loop: auth → balance check → routing → billing → visibility.

### Success criteria

- Claude Code receives a coherent response (not a 4xx)
- The wallet address appears in the admin dashboard within the same day
```

- [ ] **Step 2: Verify README renders correctly**

```bash
# Quick sanity check — look for the new section
grep -n "E2E testing with Claude Code" README.md
```
Expected: one match with the line number.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: E2E testing runbook for Claude Code → proxy → admin dashboard"
```

---

## Task 7: Vercel deployment

No code changes — deployment configuration only.

- [ ] **Step 1: Push the branch**

```bash
git push origin ma/2
```

- [ ] **Step 2: Create a new Vercel project**

1. Go to [vercel.com/new](https://vercel.com/new) and import the repo.
2. Set **Root Directory** to `packages/admin`.
3. Leave Framework Preset as **Next.js** (auto-detected).
4. Add environment variable: `NEXT_PUBLIC_PROXY_URL` = `https://api.latchkey.me`
5. Click **Deploy**.

- [ ] **Step 3: Verify deployment**

Once deployed, open the Vercel URL. The dashboard should load and show the three charts (empty if `billing_log` has no data, or populated if there are past requests).

- [ ] **Step 4: Update README with the deployed admin URL**

Replace `[admin.latchkey.me](https://admin.latchkey.me)` in the README with the actual Vercel URL, then commit:

```bash
git add README.md
git commit -m "docs: add deployed admin dashboard URL"
git push origin ma/2
```

---

## All tests green check

```bash
cd packages/proxy && bun test
```
Expected: All test suites pass.
