import { spawn, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'

const PROXY_PORT = 3002
const DB_PATH = path.join(__dirname, 'test.db')

async function waitForHealthy(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`Service at ${url} did not become healthy within ${timeoutMs}ms`)
}

let proxyProcess: ChildProcess

export default async function globalSetup() {
  // Clean up old test DB
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)

  // Start proxy with test DB and no on-chain balance check
  const proxyDir = path.join(__dirname, '..', 'proxy')
  proxyProcess = spawn(
    path.join(process.env.HOME ?? '~', '.bun', 'bin', 'bun'),
    ['run', 'src/index.ts'],
    {
      cwd: proxyDir,
      env: {
        ...process.env,
        PORT: String(PROXY_PORT),
        DB_PATH,
        BALANCE_CONTRACT_ADDRESS: '',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  proxyProcess.stdout?.on('data', (d: Buffer) => process.stdout.write(`[proxy] ${d}`))
  proxyProcess.stderr?.on('data', (d: Buffer) => process.stderr.write(`[proxy] ${d}`))
  proxyProcess.on('exit', code => {
    if (code !== null && code !== 0) console.error(`[proxy] exited with code ${code}`)
  })

  // Store PID for teardown
  process.env.E2E_PROXY_PID = String(proxyProcess.pid)

  await waitForHealthy(`http://localhost:${PROXY_PORT}/health`)

  // Seed billing data via bun subprocess (bun:sqlite not available in Node.js context)
  const bunBin = path.join(process.env.HOME ?? '~', '.bun', 'bin', 'bun')
  const seedScript = path.join(__dirname, 'seed-db.ts')
  await new Promise<void>((resolve, reject) => {
    const seed = spawn(bunBin, ['run', seedScript, DB_PATH], { stdio: 'inherit' })
    seed.on('close', code => code === 0 ? resolve() : reject(new Error(`seed exited ${code}`)))
  })

  console.log(`[e2e] Proxy running on port ${PROXY_PORT} with seeded billing data`)
}
