import type { Database } from 'bun:sqlite'

export type UsageRow = { date: string; key: string; tokens: number }

export type UsageResult = {
  byWallet: UsageRow[]
  byProvider: UsageRow[]
  byModel: UsageRow[]
}

export function queryUsage(db: Database): UsageResult {
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400

  const byWallet = db
    .query<UsageRow, [number]>(
      `SELECT date(datetime(created_at, 'unixepoch')) AS date,
              caller_address AS key,
              SUM(input_tokens + output_tokens) AS tokens
       FROM billing_log
       WHERE created_at >= ?
       GROUP BY date, caller_address
       ORDER BY date`,
    )
    .all(cutoff)

  const byProvider = db
    .query<UsageRow, [number]>(
      `SELECT date(datetime(bl.created_at, 'unixepoch')) AS date,
              p.name AS key,
              SUM(bl.input_tokens + bl.output_tokens) AS tokens
       FROM billing_log bl
       JOIN listings l ON l.id = bl.listing_id
       JOIN providers p ON p.id = l.provider_id
       WHERE bl.created_at >= ?
       GROUP BY date, p.name
       ORDER BY date`,
    )
    .all(cutoff)

  const byModel = db
    .query<UsageRow, [number]>(
      `SELECT date(datetime(created_at, 'unixepoch')) AS date,
              model_id AS key,
              SUM(input_tokens + output_tokens) AS tokens
       FROM billing_log
       WHERE created_at >= ?
       GROUP BY date, model_id
       ORDER BY date`,
    )
    .all(cutoff)

  return { byWallet, byProvider, byModel }
}
