import * as fs from 'fs'
import * as path from 'path'

export default async function globalTeardown() {
  const pid = process.env.E2E_PROXY_PID
  if (pid) {
    try {
      process.kill(Number(pid), 'SIGTERM')
      console.log(`[e2e] Proxy (pid ${pid}) stopped`)
    } catch {
      // already exited
    }
  }

  const dbPath = path.join(__dirname, 'test.db')
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
}
