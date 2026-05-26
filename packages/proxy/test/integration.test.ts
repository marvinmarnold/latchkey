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
    INSERT INTO listings (id, provider_id, model_id, upstream_format, endpoint, price_input, price_output)
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
