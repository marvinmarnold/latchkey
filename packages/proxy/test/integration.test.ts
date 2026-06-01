// packages/proxy/test/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { Elysia } from 'elysia'
import { encodeBearerToken } from '../src/middleware/auth'
import { openDb, closeDb } from '../src/db'
import { buildApp } from '../src/index'

const MOCK_PORT = 18080
const PROXY_PORT = 18081
const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

const OPENAI_NON_STREAM_RESPONSE = {
  id: 'chatcmpl-test',
  object: 'chat.completion',
  model: 'deepseek-chat',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from mock!' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
}

let mockServer: Elysia
let proxyServer: ReturnType<typeof buildApp>
let token: string
let db: ReturnType<typeof openDb>

beforeAll(async () => {
  // Clear both contract addresses so tests run in Phase 1 mock mode
  process.env.BALANCE_CONTRACT_ADDRESS = ''
  process.env.BILLING_CONTRACT_ADDRESS = ''
  token = await encodeBearerToken(TEST_KEY)

  // Mock provider — responds to POST /v1/chat/completions
  mockServer = new Elysia()
    .post('/v1/chat/completions', ({ body }) => {
      const req = body as { stream?: boolean }
      if (req.stream) {
        const enc = new TextEncoder()
        const s = new ReadableStream({
          start(c) {
            c.enqueue(enc.encode('data: {"id":"c1","model":"deepseek-chat","choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n'))
            c.enqueue(enc.encode('data: {"id":"c1","model":"deepseek-chat","choices":[{"delta":{"content":"Hello!"},"finish_reason":null}]}\n\n'))
            c.enqueue(enc.encode('data: {"id":"c1","model":"deepseek-chat","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n'))
            c.enqueue(enc.encode('data: [DONE]\n\n'))
            c.close()
          },
        })
        return new Response(s, { headers: { 'Content-Type': 'text/event-stream' } })
      }
      return OPENAI_NON_STREAM_RESPONSE
    })
  mockServer.listen(MOCK_PORT)

  // In-memory DB with mock provider and listing
  db = openDb(':memory:')
  db.run(`INSERT INTO providers (id, name) VALUES ('mock-p1', 'MockProvider')`)
  db.run(`
    INSERT INTO listings (id, provider_id, model_id, upstream_format, endpoint, price_input_usd_per_million, price_output_usd_per_million)
    VALUES ('mock-l1', 'mock-p1', 'test/TestModel', 'openai', 'http://localhost:${MOCK_PORT}/v1', 270, 1100)
  `)

  proxyServer = buildApp(db)
  proxyServer.listen(PROXY_PORT)
})

afterAll(() => {
  proxyServer?.stop()
  mockServer?.stop()
  closeDb(db)
})

describe('OpenAI endpoint', () => {
  it('returns a non-streaming response', async () => {
    const res = await fetch(`http://localhost:${PROXY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ model: 'test/TestModel', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as { choices: Array<{ message: { content: string } }> }
    expect(json.choices[0].message.content).toBe('Hello from mock!')
  })

  it('streams an SSE response', async () => {
    const res = await fetch(`http://localhost:${PROXY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ model: 'test/TestModel', messages: [{ role: 'user', content: 'Hi' }], stream: true }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('Hello!')
    expect(text).toContain('[DONE]')
  })
})

describe('Anthropic endpoint', () => {
  it('translates and returns Anthropic-format response', async () => {
    const res = await fetch(`http://localhost:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': token },
      body: JSON.stringify({ model: 'test/TestModel', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 100 }),
    })
    expect(res.status).toBe(200)
    const json = await res.json() as { type: string; content: Array<{ text: string }> }
    expect(json.type).toBe('message')
    expect(json.content[0].text).toBe('Hello from mock!')
  })

  it('streams Anthropic SSE events', async () => {
    const res = await fetch(`http://localhost:${PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': token },
      body: JSON.stringify({ model: 'test/TestModel', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 100, stream: true }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('event: message_start')
    expect(text).toContain('event: content_block_delta')
    expect(text).toContain('Hello!')
    expect(text).toContain('event: message_stop')
  })
})

describe('Auth', () => {
  it('returns 401 for missing token', async () => {
    const res = await fetch(`http://localhost:${PROXY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test/TestModel', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    expect(res.status).toBe(401)
  })
})

describe('Anthropic upstream passthrough', () => {
  // When upstream_format = 'anthropic', the proxy should pass the stream
  // through unchanged (it's already Anthropic SSE) rather than re-encoding it.
  const ANTH_MOCK_PORT = 18084
  const ANTH_PROXY_PORT = 18085
  let anthMock: Elysia
  let anthProxy: ReturnType<typeof buildApp>
  let anthDb: ReturnType<typeof openDb>
  let anthToken: string

  beforeAll(async () => {
    anthToken = await encodeBearerToken(TEST_KEY)
    anthMock = new Elysia()
      .post('/v1/messages', ({ body, set }) => {
        const req = body as { stream?: boolean }
        if (req.stream) {
          const enc = new TextEncoder()
          const s = new ReadableStream({
            start(c) {
              c.enqueue(enc.encode('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","content":[],"model":"claude-test","stop_reason":null,"usage":{"input_tokens":10,"output_tokens":1}}}\n\n'))
              c.enqueue(enc.encode('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'))
              c.enqueue(enc.encode('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello from Anthropic!"}}\n\n'))
              c.enqueue(enc.encode('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n'))
              c.enqueue(enc.encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}\n\n'))
              c.enqueue(enc.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'))
              c.close()
            },
          })
          set.headers['Content-Type'] = 'text/event-stream'
          return new Response(s)
        }
        return {
          id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-test',
          content: [{ type: 'text', text: 'Hello from Anthropic!' }],
          stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }
      })
    anthMock.listen(ANTH_MOCK_PORT)

    anthDb = openDb(':memory:')
    anthDb.run(`INSERT INTO providers (id, name) VALUES ('anth-p1', 'AnthProvider')`)
    anthDb.run(`INSERT INTO listings (id, provider_id, model_id, upstream_format, endpoint, price_input_usd_per_million, price_output_usd_per_million)
      VALUES ('anth-l1', 'anth-p1', 'claude-test-model', 'anthropic', 'http://localhost:${ANTH_MOCK_PORT}', 3.0, 15.0)`)
    anthProxy = buildApp(anthDb)
    anthProxy.listen(ANTH_PROXY_PORT)
  })

  afterAll(() => { anthProxy?.stop(); anthMock?.stop(); closeDb(anthDb) })

  it('passes Anthropic-format stream through with content intact', async () => {
    const res = await fetch(`http://localhost:${ANTH_PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthToken },
      body: JSON.stringify({ model: 'claude-test-model', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 100, stream: true }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('event: message_start')
    expect(text).toContain('Hello from Anthropic!')  // RED: currently stripped
    expect(text).toContain('event: message_stop')     // RED: currently missing
  })

  it('bills input+output tokens from Anthropic stream usage events', async () => {
    await fetch(`http://localhost:${ANTH_PROXY_PORT}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthToken },
      body: JSON.stringify({ model: 'claude-test-model', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 100, stream: true }),
    }).then(r => r.text()) // drain stream
    const row = anthDb.query('SELECT input_tokens, output_tokens FROM billing_log ORDER BY created_at DESC LIMIT 1').get() as { input_tokens: number; output_tokens: number } | null
    expect(row).not.toBeNull()
    expect(row!.input_tokens).toBe(10)   // RED: currently 0
    expect(row!.output_tokens).toBe(5)   // RED: currently 0
  })
})

describe('Upstream error passthrough', () => {
  // Spin up a second mock that returns 429 / 529 so we can verify the proxy
  // passes the real status code through rather than always returning 502.
  const RATE_MOCK_PORT = 18082
  const RATE_PROXY_PORT = 18083
  let rateMock: Elysia
  let rateProxy: ReturnType<typeof buildApp>
  let rateDb: ReturnType<typeof openDb>
  let rateToken: string
  let upstreamStatus = 429 // controlled per-test
  let retryAfterHeader = '' // set per-test to simulate upstream header

  beforeAll(async () => {
    rateToken = await encodeBearerToken(TEST_KEY)
    rateMock = new Elysia()
      .post('/v1/chat/completions', ({ set }) => {
        set.status = upstreamStatus
        if (retryAfterHeader) set.headers['retry-after'] = retryAfterHeader
        return { error: { message: 'rate limited', type: 'rate_limit_error' } }
      })
    rateMock.listen(RATE_MOCK_PORT)

    rateDb = openDb(':memory:')
    rateDb.run(`INSERT INTO providers (id, name) VALUES ('rate-p1', 'RateProvider')`)
    rateDb.run(`INSERT INTO listings (id, provider_id, model_id, upstream_format, endpoint, price_input_usd_per_million, price_output_usd_per_million)
      VALUES ('rate-l1', 'rate-p1', 'rate/model', 'openai', 'http://localhost:${RATE_MOCK_PORT}/v1', 0.27, 1.10)`)
    rateProxy = buildApp(rateDb)
    rateProxy.listen(RATE_PROXY_PORT)
  })

  afterAll(() => { rateProxy?.stop(); rateMock?.stop(); closeDb(rateDb) })

  it('passes 429 through so clients respect Retry-After', async () => {
    upstreamStatus = 429
    const res = await fetch(`http://localhost:${RATE_PROXY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rateToken}` },
      body: JSON.stringify({ model: 'rate/model', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    expect(res.status).toBe(429)
  })

  it('passes 529 (overloaded) through so clients back off correctly', async () => {
    upstreamStatus = 529
    const res = await fetch(`http://localhost:${RATE_PROXY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rateToken}` },
      body: JSON.stringify({ model: 'rate/model', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    expect(res.status).toBe(529)
  })

  it('does not penalise the listing for rate-limit errors', async () => {
    upstreamStatus = 429
    await fetch(`http://localhost:${RATE_PROXY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rateToken}` },
      body: JSON.stringify({ model: 'rate/model', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    const listing = rateDb.query('SELECT reliability FROM listings WHERE id = ?').get('rate-l1') as { reliability: number }
    expect(listing.reliability).toBe(1.0) // unchanged — rate limits are not provider failures
  })

  it('still returns 502 for genuine provider errors (5xx)', async () => {
    upstreamStatus = 500
    retryAfterHeader = ''
    const res = await fetch(`http://localhost:${RATE_PROXY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rateToken}` },
      body: JSON.stringify({ model: 'rate/model', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    expect(res.status).toBe(502)
  })

  it('forwards Retry-After header from upstream 429 so clients back off correctly', async () => {
    upstreamStatus = 429
    retryAfterHeader = '30'
    const res = await fetch(`http://localhost:${RATE_PROXY_PORT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rateToken}` },
      body: JSON.stringify({ model: 'rate/model', messages: [{ role: 'user', content: 'Hi' }] }),
    })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('30')  // RED: currently null
  })
})
