import { test, expect } from '@playwright/test'

const PROXY_URL = process.env.E2E_PROXY_URL ?? 'http://localhost:3002'
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://localhost:3001'

// Are we hitting a live production environment? If so, skip tests that assert
// specific local test data — production has real (different) data.
const IS_PRODUCTION = !!(process.env.E2E_PROXY_URL && process.env.E2E_ADMIN_URL)

// The wallet used in local E2E (matches TEST_PRIVATE_KEY in packages/proxy/.env)
const TEST_WALLET = '0xe65710F012F0Dc625c85Cd50Cb1b0A1e9E63Eb89'

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
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Latchkey Usage')
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
