import { test, expect } from '@playwright/test'

const PROXY_URL = process.env.E2E_PROXY_URL ?? 'http://localhost:3002'
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://localhost:3001'

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

  test('seeded billing data is present in byWallet', async ({ request }) => {
    const res = await request.get(`${PROXY_URL}/admin/usage`)
    const { byWallet } = await res.json() as { byWallet: Array<{ date: string; key: string; tokens: number }> }

    // We seeded data for 0xE2eTestWallet...
    const walletRows = byWallet.filter(r => r.key.toLowerCase().startsWith('0xe2etest'))
    expect(walletRows.length).toBeGreaterThan(0)
    expect(walletRows.every(r => r.tokens > 0)).toBe(true)
    expect(walletRows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true)
  })

  test('seeded billing data is present in byProvider', async ({ request }) => {
    const res = await request.get(`${PROXY_URL}/admin/usage`)
    const { byProvider } = await res.json() as { byProvider: Array<{ date: string; key: string; tokens: number }> }

    const twoShoesRows = byProvider.filter(r => r.key === 'TwoShoes')
    expect(twoShoesRows.length).toBeGreaterThan(0)
  })

  test('seeded billing data is present in byModel', async ({ request }) => {
    const res = await request.get(`${PROXY_URL}/admin/usage`)
    const { byModel } = await res.json() as { byModel: Array<{ date: string; key: string; tokens: number }> }

    const claudeRows = byModel.filter(r => r.key === 'claude-sonnet-4-6')
    expect(claudeRows.length).toBeGreaterThan(0)

    const totalTokens = claudeRows.reduce((sum, r) => sum + r.tokens, 0)
    // We seeded 1200+480 + 800+320 = 2800 claude tokens
    expect(totalTokens).toBe(2800)
  })

  test('token counts are sums of input + output', async ({ request }) => {
    const res = await request.get(`${PROXY_URL}/admin/usage`)
    const { byModel } = await res.json() as { byModel: Array<{ date: string; key: string; tokens: number }> }

    const dsRow = byModel.find(r => r.key === 'deepseek-ai/DeepSeek-V3')
    expect(dsRow).toBeDefined()
    expect(dsRow?.tokens).toBe(700) // 500 + 200
  })
})

// ---------------------------------------------------------------------------
// UI tests — admin dashboard in browser
// ---------------------------------------------------------------------------

test.describe('Admin dashboard UI', () => {
  test('page title is correct', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page).toHaveTitle('Payprompt Admin')
  })

  test('shows the heading', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Payprompt Usage')
  })

  test('renders three chart sections after data loads', async ({ page }) => {
    await page.goto(ADMIN_URL)

    // Wait for data to load (Loading... disappears)
    await expect(page.getByText('Loading…')).not.toBeVisible({ timeout: 10000 })

    // Verify no error message
    await expect(page.getByText(/Failed to load/)).not.toBeVisible()

    // Three chart titles should be present
    await expect(page.getByRole('heading', { level: 2, name: 'Tokens by Wallet' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Tokens by Provider' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Tokens by Model' })).toBeVisible()
  })

  test('Recharts SVG is rendered', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page.getByText('Loading…')).not.toBeVisible({ timeout: 10000 })

    // Recharts renders SVG elements
    const svgCount = await page.locator('svg.recharts-surface').count()
    expect(svgCount).toBeGreaterThanOrEqual(3)
  })

  test('wallet address appears truncated in legend', async ({ page }) => {
    await page.goto(ADMIN_URL)
    await expect(page.getByText('Loading…')).not.toBeVisible({ timeout: 10000 })

    // Wallet 0xE2eTestWallet... should be truncated to 0xE2eT…7890
    const legend = page.locator('.recharts-legend-wrapper').first()
    await expect(legend).toContainText('0xE2eT')
  })
})
