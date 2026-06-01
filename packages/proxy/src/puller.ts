import { keccak256 } from 'viem'
import type { Database } from 'bun:sqlite'
import type { WalletState } from './wallet'

/**
 * Chain seam for the pull worker. Kept tiny and injectable so the whole
 * settlement state machine is testable with no network — the real
 * implementation (viem) lives in makePullChain() below.
 */
export interface PullChain {
  /** Sign a pull(caller, grossAtomic) tx locally → deterministic hash + raw signed tx. No broadcast. */
  signPull(caller: string, grossAtomic: bigint): Promise<{ hash: string; raw: string }>
  /** Broadcast a raw signed tx. Idempotent: re-broadcasting the same tx is a no-op on-chain. */
  broadcastRaw(raw: string): Promise<void>
  /** Receipt for a hash, or null if not yet mined / never landed. */
  getReceipt(hash: string): Promise<{ status: 'success' | 'reverted' } | null>
  /** Wait for a hash to be mined and return its receipt. */
  waitForReceipt(hash: string): Promise<{ status: 'success' | 'reverted' }>
}

export interface PullOpts {
  thresholdUsd?: number // accrued debt that triggers a pull (default 0.10)
  scale?: number        // token atomic units per dollar (default 1e6 = USDC 6 decimals)
  maxFailures?: number  // consecutive failures before blocking (default 3)
}

const now = () => Math.floor(Date.now() / 1000)

function settle(db: Database, address: string, amountUsd: number, txHash?: string): void {
  // Deduct the SNAPSHOT (not zero) so debt accrued during the pull window survives.
  db.run(
    `UPDATE wallet_state SET
       accrued_usd = accrued_usd - ?,
       total_pulled_usd = total_pulled_usd + ?,
       pull_failure_count = 0,
       pending_pull_usd = NULL, pending_pull_tx = NULL, pending_pull_raw = NULL,
       last_pull_at = ?,
       last_pull_tx = COALESCE(?, last_pull_tx)
     WHERE address = ?`,
    [amountUsd, amountUsd, now(), txHash ?? null, address],
  )
}

function fail(db: Database, address: string, maxFailures: number): void {
  db.run(
    `UPDATE wallet_state SET
       pull_failure_count = pull_failure_count + 1,
       pending_pull_usd = NULL, pending_pull_tx = NULL, pending_pull_raw = NULL,
       blocked = CASE WHEN pull_failure_count + 1 >= ? THEN 1 ELSE 0 END
     WHERE address = ?`,
    [maxFailures, address],
  )
}

/**
 * One sweep of the pull queue. Safe to run on an interval.
 * Step 1 reconciles any in-flight pull (crash recovery); step 2 starts new pulls.
 */
export async function processPulls(db: Database, chain: PullChain, opts: PullOpts = {}): Promise<void> {
  const thresholdUsd = opts.thresholdUsd ?? 0.10
  const scale = opts.scale ?? 1_000_000
  const maxFailures = opts.maxFailures ?? 3

  // 1. Reconcile in-flight pulls FIRST (selected by pending_pull_usd, set before broadcast).
  const inflight = db
    .query<WalletState, []>(`SELECT * FROM wallet_state WHERE pending_pull_usd IS NOT NULL`)
    .all()
  const reconciled = new Set<string>()
  for (const w of inflight) {
    reconciled.add(w.address)
    // pending_pull_tx is always set alongside pending_pull_usd (same atomic write in step 2).
    // Derive it from raw as a fallback if the invariant somehow breaks.
    const hash = w.pending_pull_tx ?? (w.pending_pull_raw ? keccak256(w.pending_pull_raw as `0x${string}`) : null)
    let receipt = hash ? await chain.getReceipt(hash) : null
    if (!receipt) {
      // Never landed (crash before/at broadcast) → re-broadcast the saved raw tx.
      // Same nonce + payload = same hash, so this can't double-charge.
      if (w.pending_pull_raw) await chain.broadcastRaw(w.pending_pull_raw)
      receipt = hash ? await chain.waitForReceipt(hash) : { status: 'reverted' as const }
    }
    if (receipt.status === 'success') settle(db, w.address, w.pending_pull_usd ?? 0, hash ?? undefined)
    else fail(db, w.address, maxFailures)
  }

  // 2. New pulls for wallets over threshold with nothing in flight.
  // Skip any wallet already handled in step 1 — one action per wallet per sweep.
  const due = db
    .query<{ address: string; accrued_usd: number }, [number]>(
      `SELECT address, accrued_usd FROM wallet_state
       WHERE accrued_usd >= ? AND blocked = 0 AND pending_pull_usd IS NULL`,
    )
    .all(thresholdUsd)
  for (const w of due) {
    if (reconciled.has(w.address)) continue
    const snapshot = w.accrued_usd
    const gross = BigInt(Math.round(snapshot * scale))
    const { hash, raw } = await chain.signPull(w.address, gross)
    // Persist BEFORE broadcast — the crash-safety invariant.
    db.run(
      `UPDATE wallet_state SET pending_pull_usd = ?, pending_pull_tx = ?, pending_pull_raw = ? WHERE address = ?`,
      [snapshot, hash, raw, w.address],
    )
    await chain.broadcastRaw(raw)
    const receipt = await chain.waitForReceipt(hash)
    if (receipt.status === 'success') settle(db, w.address, snapshot, hash)
    else fail(db, w.address, maxFailures)
  }
}

/** Start the background pull worker. Returns the interval handle. */
export function startPullWorker(db: Database, chain: PullChain, opts: PullOpts = {}, intervalMs = 30_000) {
  return setInterval(() => {
    processPulls(db, chain, opts).catch(e => console.warn('[puller]', (e as Error).message))
  }, intervalMs)
}
