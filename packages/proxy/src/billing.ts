import type { Database } from 'bun:sqlite'
import type { UsageRecord } from './types'
import { randomUUID } from 'crypto'

/**
 * Cost of a request in **dollars** (the canonical internal unit).
 * Prices are dollars per million tokens. Conversion to a token's atomic units
 * (e.g. USDC's 6 decimals) happens only at settlement time — see puller.ts.
 */
export function computeCost(
  inputTokens: number,
  outputTokens: number,
  priceInputUsdPerMillion: number,
  priceOutputUsdPerMillion: number,
): number {
  return (inputTokens * priceInputUsdPerMillion + outputTokens * priceOutputUsdPerMillion) / 1_000_000
}

export function logUsage(db: Database, record: UsageRecord): { id: string; costUsd: number } {
  const id = randomUUID()
  db.run(
    `INSERT INTO billing_log (id, caller_address, listing_id, model_id, input_tokens, output_tokens, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      record.callerAddress,
      record.listingId,
      record.modelId,
      record.inputTokens,
      record.outputTokens,
      record.costUsd,
      Math.floor(Date.now() / 1000),
    ],
  )
  return { id, costUsd: record.costUsd }
}

type OAIUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number }

/**
 * For Anthropic-format SSE streams (upstream_format === 'anthropic').
 * Extracts input tokens from message_start and output tokens from message_delta,
 * then calls onUsage. Passes all chunks through unchanged.
 */
export function extractUsageFromAnthropicStream(
  stream: ReadableStream<Uint8Array>,
  onUsage: (usage: OAIUsage) => void,
): { stream: ReadableStream<Uint8Array> } {
  const decoder = new TextDecoder()
  let buf = ''
  let inputTokens = 0
  const transformed = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buf += decoder.decode(chunk, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as Record<string, unknown>
            if (data.type === 'message_start') {
              const msg = data.message as { usage?: { input_tokens?: number } } | undefined
              inputTokens = msg?.usage?.input_tokens ?? 0
            } else if (data.type === 'message_delta') {
              const outputTokens = (data.usage as { output_tokens?: number } | undefined)?.output_tokens ?? 0
              onUsage({ prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens })
            }
          } catch { /* ignore parse errors */ }
        }
        controller.enqueue(chunk)
      },
      flush() {
        if (!buf.startsWith('data: ')) return
        try {
          const data = JSON.parse(buf.slice(6)) as Record<string, unknown>
          if (data.type === 'message_delta') {
            const outputTokens = (data.usage as { output_tokens?: number } | undefined)?.output_tokens ?? 0
            onUsage({ prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens })
          }
        } catch { /* ignore */ }
      },
    }),
  )
  return { stream: transformed }
}

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
