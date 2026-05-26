import type { Database } from 'bun:sqlite'
import type { Listing } from './types'

export function selectListing(db: Database, modelId: string): Listing | null {
  // Exact match first, then prefix fallback — both require provider to be active.
  // Weighted score: (price_input + price_output) / reliability — cheaper AND reliable wins.
  return (
    db
      .query<Listing, [string]>(
        `SELECT l.* FROM listings l
         JOIN providers p ON p.id = l.provider_id
         WHERE l.model_id = ? AND l.active = 1 AND p.active = 1
         ORDER BY ((l.price_input + l.price_output) / MAX(l.reliability, 0.01)) ASC
         LIMIT 1`,
      )
      .get(modelId) ??
    db
      .query<Listing, [string]>(
        `SELECT l.* FROM listings l
         JOIN providers p ON p.id = l.provider_id
         WHERE ? LIKE (l.model_prefix || '%') AND l.model_prefix IS NOT NULL
           AND l.active = 1 AND p.active = 1
         ORDER BY ((l.price_input + l.price_output) / MAX(l.reliability, 0.01)) ASC
         LIMIT 1`,
      )
      .get(modelId)
  )
}

export function penaliseListing(db: Database, listingId: string, delta: number = 0.05): void {
  db.run(
    `UPDATE listings SET reliability = MAX(0.0, reliability - ?) WHERE id = ?`,
    [delta, listingId],
  )
}
