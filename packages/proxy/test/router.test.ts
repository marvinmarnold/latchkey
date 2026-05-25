import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { openDb, closeDb } from '../src/db'
import { selectProvider } from '../src/router'
import type { Database } from 'bun:sqlite'

let db: Database

beforeEach(() => {
  db = openDb(':memory:')
  db.run(`
    INSERT INTO providers (id, hf_repo_id, provider_model_id, endpoint, type, price_input, price_output, active)
    VALUES
      ('p1', 'deepseek-ai/DeepSeek-V3', 'deepseek-chat', 'https://expensive.example.com/v1', 'self_hosted', 500, 2000, 1),
      ('p2', 'deepseek-ai/DeepSeek-V3', 'deepseek-chat', 'https://cheap.example.com/v1',     'self_hosted', 200, 800,  1),
      ('p3', 'meta-llama/Llama-3-70B',  'llama3-70b',   'https://llama.example.com/v1',      'self_hosted', 100, 400,  1),
      ('p4', 'deepseek-ai/DeepSeek-V3', 'deepseek-chat', 'https://inactive.example.com/v1',  'self_hosted', 10,  10,   0)
  `)
})
afterEach(() => closeDb(db))

describe('selectProvider', () => {
  it('returns cheapest active provider for model', () => {
    const provider = selectProvider(db, 'deepseek-ai/DeepSeek-V3')
    expect(provider?.id).toBe('p2')
  })

  it('returns null when no active provider exists for model', () => {
    const provider = selectProvider(db, 'unknown/Model')
    expect(provider).toBeNull()
  })

  it('ignores inactive providers', () => {
    db.run(`UPDATE providers SET active = 0 WHERE id IN ('p1','p2')`)
    const provider = selectProvider(db, 'deepseek-ai/DeepSeek-V3')
    expect(provider).toBeNull()
  })
})
