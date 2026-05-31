// Runs with bun to seed test billing data into the e2e test DB
import { Database } from 'bun:sqlite'

const dbPath = process.argv[2]
if (!dbPath) throw new Error('Usage: bun seed-db.ts <db-path>')

const db = new Database(dbPath)

const now = Math.floor(Date.now() / 1000)
const yesterday = now - 86400
const listingId = 'twoshoes-anthropic'

db.run(
  `INSERT OR IGNORE INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usdc, created_at)
   VALUES ('e2e-b1', '0xE2eTestWallet1234567890abcdef1234567890', ?, 'claude-sonnet-4-6', 1200, 480, 25000, ?)`,
  [listingId, now],
)
db.run(
  `INSERT OR IGNORE INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usdc, created_at)
   VALUES ('e2e-b2', '0xE2eTestWallet1234567890abcdef1234567890', ?, 'claude-sonnet-4-6', 800, 320, 17000, ?)`,
  [listingId, yesterday],
)
db.run(
  `INSERT OR IGNORE INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usdc, created_at)
   VALUES ('e2e-b3', '0xOtherWallet1234567890abcdef12345678901', ?, 'deepseek-ai/DeepSeek-V3', 500, 200, 5000, ?)`,
  ['twoshoes-ds-v3', now],
)

db.close()
console.log('[seed] done')
