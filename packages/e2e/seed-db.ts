// Runs with bun to inject a test listing into the e2e DB after proxy startup.
// The proxy already created tables and seeded real providers — we just add a
// test listing that points at the local mock upstream so E2E requests route
// without needing real API keys.
import { Database } from 'bun:sqlite'

const dbPath = process.argv[2]
const mockPort = process.argv[3] ?? '3003'
if (!dbPath) throw new Error('Usage: bun seed-db.ts <db-path> [mock-port]')

const portNum = Number(mockPort)
if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
  throw new Error(`Invalid mock port: ${mockPort}`)
}

const db = new Database(dbPath)
try {
  db.run(
    `INSERT OR REPLACE INTO providers (id, name, active) VALUES ('e2e-provider', 'E2EProvider', 1)`,
  )
  db.run(
    `INSERT OR REPLACE INTO listings
       (id, provider_id, model_id, upstream_format, endpoint, price_input_usd_per_million, price_output_usd_per_million, active)
     VALUES ('e2e-listing', 'e2e-provider', 'e2e-test-model', 'openai', ?, 0.10, 0.20, 1)`,
    [`http://localhost:${portNum}/v1`],
  )
  console.log(`[seed] test listing injected → http://localhost:${portNum}/v1`)
} finally {
  db.close()
}
