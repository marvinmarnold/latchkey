import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { openDb, closeDb, seedProviders } from '../src/db'
import { logUsage, extractUsageFromStream } from '../src/billing'
import type { Database } from 'bun:sqlite'

let db: Database
beforeEach(() => {
  db = openDb(':memory:')
  seedProviders(db)
})
afterEach(() => closeDb(db))

describe('logUsage', () => {
  it('inserts a billing_log row and returns cost', () => {
    const cost = logUsage(db, {
      callerAddress: '0xabc',
      listingId: 'twoshoes-deepseek',
      modelId: 'deepseek-chat',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      costUsdc: 1370,
    })
    expect(cost).toBe(1370)
    const row = db.query('SELECT * FROM billing_log').get() as { input_tokens: number }
    expect(row.input_tokens).toBe(1_000_000)
  })
})

describe('extractUsageFromStream', () => {
  it('intercepts usage from OpenAI SSE and passes chunks through', async () => {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ]
    const source = new ReadableStream({
      start(c) { chunks.forEach(ch => c.enqueue(encoder.encode(ch))); c.close() }
    })

    let capturedUsage: { prompt_tokens: number; completion_tokens: number } | null = null
    const { stream } = extractUsageFromStream(source, u => { capturedUsage = u })

    const reader = stream.getReader()
    const out: string[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      out.push(decoder.decode(value))
    }

    expect(capturedUsage?.prompt_tokens).toBe(5)
    expect(capturedUsage?.completion_tokens).toBe(2)
    expect(out.join('')).toContain('"content":"Hi"')
  })
})
