import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { openDb, closeDb, seedProviders } from '../src/db'
import type { Database } from 'bun:sqlite'

let db: Database

beforeEach(() => { db = openDb(':memory:') })
afterEach(() => { closeDb(db) })

describe('db', () => {
  it('creates providers table', () => {
    const row = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='providers'`).get()
    expect(row).not.toBeNull()
  })

  it('creates billing_log table', () => {
    const row = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='billing_log'`).get()
    expect(row).not.toBeNull()
  })

  it('creates listings table', () => {
    const row = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='listings'`).get()
    expect(row).not.toBeNull()
  })

  it('seeds providers and listings when asked', () => {
    seedProviders(db)
    const providers = (db.query('SELECT COUNT(*) as n FROM providers').get() as { n: number }).n
    const listings = (db.query('SELECT COUNT(*) as n FROM listings').get() as { n: number }).n
    expect(providers).toBe(2)
    expect(listings).toBeGreaterThan(0)
  })
})
