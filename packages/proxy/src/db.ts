import { Database } from 'bun:sqlite'

export function openDb(path: string = process.env.DB_PATH ?? './payprompt.db'): Database {
  const db = new Database(path, { create: true })
  db.run('PRAGMA journal_mode = WAL')

  // Migrate from old single-table schema (providers had hf_repo_id column)
  const hasOldSchema = db
    .query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM pragma_table_info('providers') WHERE name = 'hf_repo_id'`,
    )
    .get()
  if (hasOldSchema && hasOldSchema.count > 0) {
    db.run('DROP TABLE IF EXISTS billing_log')
    db.run('DROP TABLE IF EXISTS providers')
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS providers (
      id     TEXT PRIMARY KEY,
      name   TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS listings (
      id                TEXT PRIMARY KEY,
      provider_id       TEXT NOT NULL REFERENCES providers(id),
      model_id          TEXT,
      model_prefix      TEXT,
      upstream_format   TEXT NOT NULL DEFAULT 'openai' CHECK(upstream_format IN ('openai', 'anthropic')),
      endpoint          TEXT NOT NULL,
      api_key           TEXT,
      provider_model_id TEXT,
      price_input       INTEGER NOT NULL,
      price_output      INTEGER NOT NULL,
      ctx_length        INTEGER,
      reliability       REAL NOT NULL DEFAULT 1.0,
      active            INTEGER NOT NULL DEFAULT 1,
      CHECK (model_id IS NOT NULL OR model_prefix IS NOT NULL)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS billing_log (
      id             TEXT PRIMARY KEY,
      caller_address TEXT NOT NULL,
      listing_id     TEXT NOT NULL,
      model_id       TEXT NOT NULL,
      input_tokens   INTEGER NOT NULL,
      output_tokens  INTEGER NOT NULL,
      cost_usdc      INTEGER NOT NULL,
      created_at     INTEGER NOT NULL
    )
  `)

  return db
}

export function closeDb(db: Database): void {
  db.close()
}

export function seedProviders(db: Database): void {
  // Provider: TwoShoes — DeepSeek + Anthropic
  db.run(`INSERT OR IGNORE INTO providers (id, name) VALUES (?, ?)`, ['twoshoes', 'TwoShoes'])

  db.run(
    `INSERT INTO listings
       (id, provider_id, model_prefix, upstream_format, endpoint, api_key, price_input, price_output)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET api_key = excluded.api_key`,
    [
      'twoshoes-anthropic',
      'twoshoes',
      'claude-',
      'anthropic',
      'https://api.anthropic.com',
      process.env.ANTHROPIC_API_KEY ?? null,
      3000,    // ~$3/M input (rough Claude Sonnet tier)
      15000,   // ~$15/M output
    ],
  )

  // Exact aliases for HF repo IDs → DeepSeek API model names
  const deepseekAliases: Array<[string, string, string]> = [
    ['deepseek-ai/DeepSeek-V3',        'deepseek-v4-pro',   'twoshoes-ds-v3'],
    ['deepseek-ai/DeepSeek-V4-Pro',    'deepseek-v4-pro',   'twoshoes-ds-v4-pro'],
    ['deepseek-ai/DeepSeek-V4-Flash',  'deepseek-v4-flash', 'twoshoes-ds-v4-flash'],
    ['deepseek-ai/DeepSeek-R1',        'deepseek-v4-flash', 'twoshoes-ds-r1'],
  ]
  for (const [modelId, providerModelId, id] of deepseekAliases) {
    db.run(
      `INSERT INTO listings
         (id, provider_id, model_id, provider_model_id, upstream_format, endpoint, api_key, price_input, price_output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET api_key = excluded.api_key`,
      [id, 'twoshoes', modelId, providerModelId, 'openai', 'https://api.deepseek.com/v1', process.env.DEEPSEEK_API_KEY ?? null, 270, 1100],
    )
  }

  // Prefix catch-all for deepseek- native API names (e.g. deepseek-v4-pro sent directly)
  db.run(
    `INSERT INTO listings
       (id, provider_id, model_prefix, upstream_format, endpoint, api_key, price_input, price_output)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET api_key = excluded.api_key`,
    ['twoshoes-deepseek', 'twoshoes', 'deepseek-', 'openai', 'https://api.deepseek.com/v1', process.env.DEEPSEEK_API_KEY ?? null, 270, 1100],
  )

  // Provider: BigThought — OpenAI only
  db.run(`INSERT OR IGNORE INTO providers (id, name) VALUES (?, ?)`, ['bigthought', 'BigThought'])

  db.run(
    `INSERT INTO listings
       (id, provider_id, model_prefix, upstream_format, endpoint, api_key, price_input, price_output)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET api_key = excluded.api_key`,
    [
      'bigthought-gpt',
      'bigthought',
      'gpt-',
      'openai',
      'https://api.openai.com/v1',
      process.env.OPENAI_API_KEY ?? null,
      2500,   // ~$2.50/M input (gpt-4o tier)
      10000,  // ~$10/M output
    ],
  )

  const oModels = ['o1', 'o1-mini', 'o1-pro', 'o3', 'o3-mini', 'o4-mini']
  for (const model of oModels) {
    db.run(
      `INSERT INTO listings
         (id, provider_id, model_id, upstream_format, endpoint, api_key, price_input, price_output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET api_key = excluded.api_key`,
      [
        `bigthought-${model}`,
        'bigthought',
        model,
        'openai',
        'https://api.openai.com/v1',
        process.env.OPENAI_API_KEY ?? null,
        2500,
        10000,
      ],
    )
  }
}
