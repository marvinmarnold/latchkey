import { Database } from 'bun:sqlite'

export function openDb(path: string = process.env.DB_PATH ?? './colosseum.db'): Database {
  const db = new Database(path, { create: true })
  db.run('PRAGMA journal_mode = WAL')
  db.run(`
    CREATE TABLE IF NOT EXISTS providers (
      id                TEXT PRIMARY KEY,
      hf_repo_id        TEXT NOT NULL,
      provider_model_id TEXT NOT NULL,
      endpoint          TEXT NOT NULL,
      type              TEXT NOT NULL CHECK(type IN ('self_hosted','api_delegating')),
      api_key           TEXT,
      price_input       INTEGER NOT NULL,
      price_output      INTEGER NOT NULL,
      ctx_length        INTEGER,
      quantization      TEXT,
      reliability       REAL NOT NULL DEFAULT 1.0,
      active            INTEGER NOT NULL DEFAULT 1
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS billing_log (
      id              TEXT PRIMARY KEY,
      caller_address  TEXT NOT NULL,
      provider_id     TEXT NOT NULL,
      hf_repo_id      TEXT NOT NULL,
      input_tokens    INTEGER NOT NULL,
      output_tokens   INTEGER NOT NULL,
      cost_usdc       INTEGER NOT NULL,
      created_at      INTEGER NOT NULL
    )
  `)
  return db
}

export function closeDb(db: Database): void {
  db.close()
}

export function seedProviders(db: Database): void {
  db.run(
    `INSERT OR IGNORE INTO providers
       (id, hf_repo_id, provider_model_id, endpoint, type, api_key, price_input, price_output, ctx_length)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'deepseek-v3-01',
      'deepseek-ai/DeepSeek-V3',
      'deepseek-chat',
      'https://api.deepseek.com/v1',
      'api_delegating',
      process.env.DEEPSEEK_API_KEY ?? null,
      270,
      1100,
      65536,
    ],
  )
}
