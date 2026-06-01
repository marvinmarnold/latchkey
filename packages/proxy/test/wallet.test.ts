import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { openDb, closeDb } from '../src/db'
import { accrue, getWalletState, assertWalletAllowed } from '../src/wallet'
import type { Database } from 'bun:sqlite'

let db: Database
beforeEach(() => { db = openDb(':memory:') })
afterEach(() => closeDb(db))

describe('accrue', () => {
  it('creates a wallet row and adds the dollar cost', () => {
    accrue(db, '0xabc', 0.03)
    expect(getWalletState(db, '0xabc')?.accrued_usd).toBeCloseTo(0.03, 10)
  })

  it('accumulates across multiple requests', () => {
    accrue(db, '0xabc', 0.03)
    accrue(db, '0xabc', 0.05)
    expect(getWalletState(db, '0xabc')?.accrued_usd).toBeCloseTo(0.08, 10)
  })
})

describe('assertWalletAllowed', () => {
  const threshold = 100_000n // 0.10 USDC at 6 decimals

  it('rejects a blocked wallet with 402 (no RPC)', async () => {
    db.run(`INSERT INTO wallet_state (address, blocked) VALUES ('0xblk', 1)`)
    let called = false
    const readAllowance = async () => { called = true; return 10_000_000n }
    await expect(
      assertWalletAllowed(db, '0xblk', { readAllowance, thresholdAtomic: threshold }),
    ).rejects.toMatchObject({ statusCode: 402 })
    expect(called).toBe(false)
  })

  it('rejects a first-seen wallet with insufficient allowance', async () => {
    const readAllowance = async () => 50_000n // 0.05 < 0.10
    await expect(
      assertWalletAllowed(db, '0xnew', { readAllowance, thresholdAtomic: threshold }),
    ).rejects.toMatchObject({ statusCode: 402 })
    expect(getWalletState(db, '0xnew')).toBeNull() // not cached on rejection
  })

  it('admits and caches a first-seen wallet with sufficient allowance', async () => {
    const readAllowance = async () => 10_000_000n
    await assertWalletAllowed(db, '0xok', { readAllowance, thresholdAtomic: threshold })
    expect(getWalletState(db, '0xok')).not.toBeNull()
  })

  it('skips the allowance RPC for a known unblocked wallet', async () => {
    accrue(db, '0xknown', 0.01) // creates a row
    let called = false
    const readAllowance = async () => { called = true; return 0n }
    await assertWalletAllowed(db, '0xknown', { readAllowance, thresholdAtomic: threshold })
    expect(called).toBe(false)
  })
})
