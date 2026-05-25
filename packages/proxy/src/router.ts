import type { Database } from 'bun:sqlite'
import type { Provider } from './types'

export function selectProvider(db: Database, hfRepoId: string): Provider | null {
  return db
    .query<Provider, [string]>(
      `SELECT * FROM providers
       WHERE hf_repo_id = ? AND active = 1
       ORDER BY (price_input + price_output) ASC
       LIMIT 1`,
    )
    .get(hfRepoId)
}

export function penaliseProvider(db: Database, providerId: string, delta: number = 0.05): void {
  db.run(
    `UPDATE providers
     SET reliability = MAX(0.0, reliability - ?)
     WHERE id = ?`,
    [delta, providerId],
  )
}
