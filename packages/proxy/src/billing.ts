import type { Database } from 'bun:sqlite'
import type { UsageRecord } from './types'
import { randomUUID } from 'crypto'

export function computeCost(
  inputTokens: number,
  outputTokens: number,
  priceInput: number,
  priceOutput: number,
): number {
  return Math.ceil((inputTokens * priceInput + outputTokens * priceOutput) / 1_000_000)
}

export function logUsage(db: Database, record: UsageRecord): number {
  db.run(
    `INSERT INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usdc, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      record.callerAddress,
      record.listingId,
      record.modelId,
      record.inputTokens,
      record.outputTokens,
      record.costUsdc,
      Math.floor(Date.now() / 1000),
    ],
  )
  return record.costUsdc
}

type OAIUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number }

export function extractUsageFromStream(
  stream: ReadableStream<Uint8Array>,
  onUsage: (usage: OAIUsage) => void,
): { stream: ReadableStream<Uint8Array> } {
  const decoder = new TextDecoder()
  let buf = ''
  const transformed = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buf += decoder.decode(chunk, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
          try {
            const data = JSON.parse(line.slice(6)) as { usage?: OAIUsage }
            if (data.usage) onUsage(data.usage)
          } catch { /* ignore parse errors */ }
        }
        controller.enqueue(chunk)
      },
      flush() {
        if (!buf) return
        if (buf.startsWith('data: ') && !buf.includes('[DONE]')) {
          try {
            const data = JSON.parse(buf.slice(6)) as { usage?: OAIUsage }
            if (data.usage) onUsage(data.usage)
          } catch { /* ignore */ }
        }
      },
    }),
  )
  return { stream: transformed }
}
