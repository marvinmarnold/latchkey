import type { Database } from 'bun:sqlite'
import { randomUUID } from 'crypto'

export interface ProofJob {
  billingLogId: string
  callerAddress: string
  providerHost: string
  inputTokens: number
  outputTokens: number
}

/**
 * Enqueue a TLS proof job after a request completes.
 *
 * Phase 3 status: STUB — no production-ready zkTLS library exists for this use case
 * as of mid-2026. Candidate libraries: TLSNotary, Reclaim Protocol, zkPass.
 * The proof must cover: server identity (e.g. api.anthropic.com), response body
 * (usage.input_tokens, usage.output_tokens), without revealing the provider API key.
 * Proof generation is estimated at seconds-to-minutes; async settlement is mandatory.
 *
 * When a library is ready: replace processProofQueue() with real proof submission.
 */
export function enqueueProofJob(db: Database, job: ProofJob): void {
  const now = Date.now()
  db.run(
    `INSERT INTO tls_proof_queue
       (id, billing_log_id, caller_address, provider_host, input_tokens, output_tokens, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [randomUUID(), job.billingLogId, job.callerAddress, job.providerHost, job.inputTokens, job.outputTokens, now, now],
  )
}

/**
 * Background worker — processes pending proof jobs.
 * Currently logs intent and marks as 'submitted' (no real proof generated).
 */
export function processProofQueue(db: Database): void {
  const pending = db
    .query<{ id: string; billing_log_id: string; provider_host: string }, []>(
      `SELECT id, billing_log_id, provider_host FROM tls_proof_queue WHERE status = 'pending' LIMIT 10`,
    )
    .all()

  for (const job of pending) {
    // TODO: submit to TLSNotary/Reclaim when production library available
    console.log(`[zkTLS stub] proof job ${job.id} for billing ${job.billing_log_id} via ${job.provider_host} — queued, no prover available yet`)
    db.run(
      `UPDATE tls_proof_queue SET status = 'submitted', updated_at = ? WHERE id = ?`,
      [Date.now(), job.id],
    )
  }
}

/** Start a background interval to drain the proof queue. */
export function startProofWorker(db: Database, intervalMs = 30_000): ReturnType<typeof setInterval> {
  return setInterval(() => processProofQueue(db), intervalMs)
}
