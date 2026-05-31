import { spawn, type ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as http from 'http'

const PROXY_PORT = 3002
const MOCK_UPSTREAM_PORT = 3003
const DB_PATH = path.join(__dirname, 'test.db')

// The wallet used for E2E testing — matches TEST_PRIVATE_KEY in packages/proxy/.env
const TEST_PRIVATE_KEY = '0x6007ce7814ba19c6db28ed536e710ae7a10454d2f599356beaa6a71f91ffa7f1'
export const TEST_WALLET = '0xe65710F012F0Dc625c85Cd50Cb1b0A1e9E63Eb89'

async function waitForHealthy(url: string, timeoutMs = 20000): Promise<void> {
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

// Minimal mock upstream: returns a valid OpenAI non-streaming completion
function startMockUpstream(): Promise<http.Server> {
  return new Promise(resolve => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl-e2e',
        object: 'chat.completion',
        model: 'claude-sonnet-4-6',
        choices: [{ index: 0, message: { role: 'assistant', content: 'e2e test response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }))
    })
    server.listen(MOCK_UPSTREAM_PORT, () => resolve(server))
  })
}

let proxyProcess: ChildProcess
let mockServer: http.Server

export default async function globalSetup() {
  // Clean up old test DB
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)

  // Start mock upstream so the proxy has somewhere to forward requests
  mockServer = await startMockUpstream()
  process.env.E2E_MOCK_SERVER_STARTED = '1'

  // Start proxy with test DB and no on-chain balance check
  const proxyDir = path.join(__dirname, '..', 'proxy')
  const bunBin = path.join(process.env.HOME ?? '~', '.bun', 'bin', 'bun')
  proxyProcess = spawn(
    bunBin,
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
  process.env.E2E_PROXY_PID = String(proxyProcess.pid)

  await waitForHealthy(`http://localhost:${PROXY_PORT}/health`)

  // Inject a test listing pointing at the mock upstream, via bun sqlite
  const bunBinPath = path.join(process.env.HOME ?? '~', '.bun', 'bin', 'bun')
  await new Promise<void>((resolve, reject) => {
    const seed = spawn(bunBinPath, ['run', path.join(__dirname, 'seed-db.ts'), DB_PATH, String(MOCK_UPSTREAM_PORT)], {
      stdio: 'inherit',
    })
    seed.on('close', code => code === 0 ? resolve() : reject(new Error(`seed exited ${code}`)))
  })

  // Phase 1 smoke test: generate a real bearer token and make an actual proxy request
  // This proves auth → routing → billing works end-to-end
  const tokenResult = await new Promise<string>((resolve, reject) => {
    const tokenProc = spawn(bunBinPath, [
      '-e',
      `import { encodeBearerToken } from './src/middleware/auth.ts'
       const token = await encodeBearerToken('${TEST_PRIVATE_KEY}')
       process.stdout.write(token)`,
    ], { cwd: proxyDir, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    tokenProc.stdout?.on('data', (d: Buffer) => { out += d.toString() })
    tokenProc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(`token gen exited ${code}`)))
  })

  const proxyRes = await fetch(`http://localhost:${PROXY_PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenResult}` },
    body: JSON.stringify({ model: 'e2e-test-model', messages: [{ role: 'user', content: 'phase 1 test' }] }),
  })

  if (proxyRes.status !== 200) {
    const body = await proxyRes.text()
    throw new Error(`Phase 1 smoke test failed: HTTP ${proxyRes.status} — ${body}`)
  }

  console.log(`[e2e] Phase 1 smoke test passed — proxy responded ${proxyRes.status} for wallet ${TEST_WALLET}`)
  console.log(`[e2e] Proxy running on port ${PROXY_PORT} with live billing data`)

  // Write the token to a temp file so the billing loop test can make its own request
  fs.writeFileSync(path.join(__dirname, '.e2e-token'), tokenResult, 'utf8')
}
