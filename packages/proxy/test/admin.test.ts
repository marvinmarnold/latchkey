import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test'
import { openDb, closeDb } from '../src/db'
import { queryUsage } from '../src/admin'
import { buildApp } from '../src/index'
import type { Database } from 'bun:sqlite'

let db: Database

beforeEach(() => {
  db = openDb(':memory:')
  db.run(`INSERT INTO providers (id, name) VALUES ('p1', 'TestProvider')`)
  db.run(`
    INSERT INTO listings (id, provider_id, model_id, upstream_format, endpoint, price_input_usd_per_million, price_output_usd_per_million)
    VALUES ('l1', 'p1', 'test-model', 'openai', 'https://example.com', 100, 200)
  `)
  const now = Math.floor(Date.now() / 1000)
  db.run(
    `INSERT INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usd, created_at)
     VALUES ('b1', '0xabc', 'l1', 'test-model', 100, 50, 10, ?)`, [now],
  )
  db.run(
    `INSERT INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usd, created_at)
     VALUES ('b2', '0xabc', 'l1', 'test-model', 200, 100, 20, ?)`, [now],
  )
  db.run(
    `INSERT INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usd, created_at)
     VALUES ('b3', '0xdef', 'l1', 'test-model', 50, 25, 5, ?)`, [now],
  )
})

afterEach(() => closeDb(db))

describe('queryUsage', () => {
  it('byWallet groups by caller_address and sums tokens', () => {
    const { byWallet } = queryUsage(db)
    const abcRow = byWallet.find(r => r.key === '0xabc')
    const defRow = byWallet.find(r => r.key === '0xdef')
    expect(abcRow?.tokens).toBe(450)
    expect(defRow?.tokens).toBe(75)
  })

  it('byProvider groups by provider name', () => {
    const { byProvider } = queryUsage(db)
    const row = byProvider.find(r => r.key === 'TestProvider')
    expect(row?.tokens).toBe(525)
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
      `INSERT INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usd, created_at)
       VALUES ('b_old', '0xold', 'l1', 'test-model', 999, 999, 99, ?)`, [old],
    )
    const { byWallet } = queryUsage(db)
    expect(byWallet.find(r => r.key === '0xold')).toBeUndefined()
  })
})

const ADMIN_PORT = 19090

describe('GET /admin/usage', () => {
  let server: ReturnType<ReturnType<typeof buildApp>['listen']>

  beforeAll(() => {
    const testDb = openDb(':memory:')
    testDb.run(`INSERT INTO providers (id, name) VALUES ('p1', 'TestProvider')`)
    testDb.run(`
      INSERT INTO listings (id, provider_id, model_id, upstream_format, endpoint, price_input_usd_per_million, price_output_usd_per_million)
      VALUES ('l1', 'p1', 'test-model', 'openai', 'https://example.com', 100, 200)
    `)
    const now = Math.floor(Date.now() / 1000)
    testDb.run(
      `INSERT INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usd, created_at)
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
