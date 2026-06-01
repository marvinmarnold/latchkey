import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { openDb, closeDb } from '../src/db'
import { selectListing } from '../src/router'
import type { Database } from 'bun:sqlite'

let db: Database

beforeEach(() => {
  db = openDb(':memory:')
  // Seed two providers
  db.run(`INSERT INTO providers (id, name) VALUES ('pa', 'ProviderA'), ('pb', 'ProviderB')`)
  db.run(`
    INSERT INTO listings (id, provider_id, model_id, model_prefix, upstream_format, endpoint, price_input_usd_per_million, price_output_usd_per_million, active)
    VALUES
      ('l1', 'pa', NULL, 'deepseek-', 'openai', 'https://expensive.example.com/v1', 500,  2000, 1),
      ('l2', 'pb', NULL, 'deepseek-', 'openai', 'https://cheap.example.com/v1',     200,  800,  1),
      ('l3', 'pa', NULL, 'claude-',   'anthropic', 'https://anthropic.example.com', 3000, 15000, 1),
      ('l4', 'pb', 'o1', NULL,        'openai', 'https://openai.example.com/v1',    2500, 10000, 1),
      ('l5', 'pa', NULL, 'deepseek-', 'openai', 'https://inactive.example.com/v1',  10,   10,   0)
  `)
})
afterEach(() => closeDb(db))

describe('selectListing', () => {
  it('returns cheapest active listing by prefix match', () => {
    const listing = selectListing(db, 'deepseek-chat')
    expect(listing?.id).toBe('l2')
  })

  it('returns null when no active listing matches', () => {
    const listing = selectListing(db, 'unknown-model')
    expect(listing).toBeNull()
  })

  it('ignores inactive listings', () => {
    db.run(`UPDATE listings SET active = 0 WHERE id = 'l2'`)
    const listing = selectListing(db, 'deepseek-chat')
    expect(listing?.id).toBe('l1')
  })

  it('ignores listings from inactive providers', () => {
    db.run(`UPDATE providers SET active = 0 WHERE id = 'pb'`)
    const listing = selectListing(db, 'deepseek-chat')
    expect(listing?.id).toBe('l1')
  })

  it('matches exact model_id over prefix', () => {
    const listing = selectListing(db, 'o1')
    expect(listing?.id).toBe('l4')
  })

  it('matches anthropic prefix', () => {
    const listing = selectListing(db, 'claude-sonnet-4-6')
    expect(listing?.id).toBe('l3')
  })
})
