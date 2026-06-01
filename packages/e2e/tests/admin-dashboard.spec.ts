import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const PROXY_URL = process.env.E2E_PROXY_URL ?? 'http://localhost:3002'
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://localhost:3001'

// Are we hitting a live production environment? If so, skip tests that assert
// specific local test data — production has real (different) data.
const IS_PRODUCTION = !!(process.env.E2E_PROXY_URL && process.env.E2E_ADMIN_URL)

// The wallet used in local E2E (matches TEST_PRIVATE_KEY in packages/proxy/.env)
const TEST_WALLET = '0xe65710F012F0Dc625c85Cd50Cb1b0A1e9E63Eb89'

// Production billing smoke test: E2E_BEARER_TOKEN must be pre-generated and passed in.
// Local: global-setup already runs the smoke test before Playwright starts.
const BEARER_TOKEN = process.env.E2E_BEARER_TOKEN ?? ''

// ---------------------------------------------------------------------------
// API contract tests — /admin/usage endpoint
// ---------------------------------------------------------------------------

test.describe('GET /admin/usage', () => {
  test('returns 200 with correct shape', async ({ request }) => {
    const res = await request.get(`${PROXY_URL}/admin/usage`)
    expect(res.status()).toBe(200)

    const json = await res.json() as { byWallet: unknown[]; byProvider: unknown[]; byModel: unknown[] }
    expect(Array.isArray(json.byWallet)).toBe(true)
    expect(Array.isArray(json.byProvider)).toBe(true)
    expect(Array.isArray(json.byModel)).toBe(true)
  })

  test('includes CORS header', async ({ request }) => {
    const res = await request.get(`${PROXY_URL}/admin/usage`)
    expect(res.headers()['access-control-allow-origin']).toBe('*')
  })

  test('rows have valid date, key, tokens fields', async ({ request }) => {
    const res = await request.get(`${PROXY_URL}/admin/usage`)
    const { byWallet, byProvider, byModel } = await res.json() as {
      byWallet: Array<{ date: string; key: string; tokens: number }>
      byProvider: Array<{ date: string; key: string; tokens: number }>
      byModel: Array<{ date: string; key: string; tokens: number }>
    }
    for (const rows of [byWallet, byProvider, byModel]) {
      for (const row of rows) {
        expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(typeof row.key).toBe('string')
        expect(row.tokens).toBeGreaterThan(0)
      }
    }
  })

  // --- Local-only tests: assert specific values from the phase 1 smoke request ---

  test('phase 1 smoke request appears in byWallet', async ({ request }) => {
    test.skip(IS_PRODUCTION, 'local test wallet not present in production DB')
    const res = await request.get(`${PROXY_URL}/admin/usage`)
    const { byWallet } = await res.json() as { byWallet: Array<{ date: string; key: string; tokens: number }> }

    const row = byWallet.find(r => r.key.toLowerCase() === TEST_WALLET.toLowerCase())
    expect(row).toBeDefined()
    expect(row?.tokens).toBeGreaterThan(0)
    expect(row?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('phase 1 smoke request appears in byProvider', async ({ request }) => {
    test.skip(IS_PRODUCTION, 'local test provider not present in production DB')
    const res = await request.get(`${PROXY_URL}/admin/usage`)
    const { byProvider } = await res.json() as { byProvider: Array<{ date: string; key: string; tokens: number }> }

    const row = byProvider.find(r => r.key === 'E2EProvider')
    expect(row).toBeDefined()
    expect(row?.tokens).toBeGreaterThan(0)
  })

  test('phase 1 smoke request appears in byModel', async ({ request }) => {
    test.skip(IS_PRODUCTION, 'local test model not present in production DB')
    const res = await request.get(`${PROXY_URL}/admin/usage`)
    const { byModel } = await res.json() as { byModel: Array<{ date: string; key: string; tokens: number }> }

    const row = byModel.find(r => r.key === 'e2e-test-model')
    expect(row).toBeDefined()
    expect(row?.tokens).toBe(15) // mock upstream returns prompt_tokens:10 + completion_tokens:5
  })
})

// ---------------------------------------------------------------------------
// UI tests — admin dashboard in browser
// ---------------------------------------------------------------------------

test.describe('Admin dashboard UI', () => {
  test('page title is correct', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page).toHaveTitle('Latchkey Admin')
  })

  test('shows the heading', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Latchkey')
  })

  test('renders three chart sections after data loads', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page.getByText('Loading…')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Failed to load/)).not.toBeVisible()

    await expect(page.getByRole('heading', { level: 2, name: 'Tokens by Wallet' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Tokens by Provider' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Tokens by Model' })).toBeVisible()
  })

  test('Recharts SVG is rendered', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page.getByText('Loading…')).not.toBeVisible({ timeout: 10000 })

    const svgCount = await page.locator('svg.recharts-surface').count()
    expect(svgCount).toBeGreaterThanOrEqual(3)
  })

  test('EVM wallet addresses are truncated in legend', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page.getByText('Loading…')).not.toBeVisible({ timeout: 10000 })

    const legend = page.locator('.recharts-legend-wrapper').first()
    const text = await legend.textContent() ?? ''

    // Un-truncated EVM addresses must not appear
    const rawEvmPattern = /0x[0-9a-fA-F]{10,}/
    expect(rawEvmPattern.test(text)).toBe(false)

    if (!IS_PRODUCTION) {
      // Local: the test wallet 0xe65710... should appear truncated as 0xe657…Eb89
      expect(text).toContain('0xe657')
    } else {
      if (text.includes('0x')) {
        expect(/0x[0-9a-fA-F]{4}…/.test(text)).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Full billing loop smoke test
// Verifies: real request → proxy logs billing → /admin/usage reflects it.
// Local:      always runs (global-setup already made the request; this checks
//             the result that persisted into the running proxy's DB).
// Production: runs only when E2E_BEARER_TOKEN is provided.
// ---------------------------------------------------------------------------

test.describe('Billing loop', () => {
  test('a proxied request appears in /admin/usage', async ({ request }) => {
    test.skip(IS_PRODUCTION && !BEARER_TOKEN, 'set E2E_BEARER_TOKEN to run billing smoke test against production')

    // Resolve the bearer token: env var (production) or temp file written by global-setup (local)
    const tokenFile = path.join(__dirname, '..', '.e2e-token')
    const token = BEARER_TOKEN || (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8').trim() : '')
    if (!token) throw new Error('No bearer token available for billing loop test')

    // Snapshot current total for the test wallet
    const before = await request.get(`${PROXY_URL}/admin/usage`)
    const beforeData = await before.json() as { byWallet: Array<{ key: string; tokens: number }> }
    const tokensBefore = beforeData.byWallet
      .filter(r => r.key.toLowerCase() === TEST_WALLET.toLowerCase())
      .reduce((s, r) => s + r.tokens, 0)

    // Make a real request through the proxy
    const proxyRes = await request.post(`${PROXY_URL}/v1/messages`, {
      headers: { 'Content-Type': 'application/json', 'x-api-key': token },
      data: { model: IS_PRODUCTION ? 'claude-haiku-4-5-20251001' : 'e2e-test-model', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] },
    })
    expect(proxyRes.status()).toBe(200)

    // Poll /admin/usage until the wallet's token count increases (up to 10 s)
    const deadline = Date.now() + 10000
    let tokensAfter = tokensBefore
    while (Date.now() < deadline) {
      const after = await request.get(`${PROXY_URL}/admin/usage`)
      const afterData = await after.json() as { byWallet: Array<{ key: string; tokens: number }> }
      tokensAfter = afterData.byWallet
        .filter(r => r.key.toLowerCase() === TEST_WALLET.toLowerCase())
        .reduce((s, r) => s + r.tokens, 0)
      if (tokensAfter > tokensBefore) break
      await new Promise(r => setTimeout(r, 500))
    }

    expect(tokensAfter).toBeGreaterThan(tokensBefore)
  })
})
