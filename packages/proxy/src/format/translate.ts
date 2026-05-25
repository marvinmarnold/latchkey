import type { OpenAIResponse, AnthropicResponse } from '../types'

export function translateOpenAIToAnthropic(res: OpenAIResponse): AnthropicResponse {
  const choice = res.choices[0]
  return {
    id: res.id.replace('chatcmpl-', 'msg_'),
    type: 'message',
    role: 'assistant',
    model: res.model,
    content: [{ type: 'text', text: choice?.message?.content ?? '' }],
    stop_reason: choice?.finish_reason === 'stop' ? 'end_turn' : (choice?.finish_reason ?? null),
    stop_sequence: null,
    usage: {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
    },
  }
}

export function openAIStreamToAnthropicStream(
  openAIStream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const msgId = `msg_${Math.random().toString(36).slice(2, 10)}`
  let headerSent = false

  function emit(event: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  return openAIStream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true })
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') {
            controller.enqueue(emit('message_stop', { type: 'message_stop' }))
            return
          }
          let parsed: Record<string, unknown>
          try { parsed = JSON.parse(raw) } catch { continue }

          if (!headerSent) {
            headerSent = true
            controller.enqueue(emit('message_start', {
              type: 'message_start',
              message: {
                id: msgId, type: 'message', role: 'assistant',
                content: [], model: parsed.model ?? '',
                stop_reason: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            }))
            controller.enqueue(emit('content_block_start', {
              type: 'content_block_start', index: 0,
              content_block: { type: 'text', text: '' },
            }))
          }

          const choices = parsed.choices as Array<{ delta?: { content?: string }; finish_reason?: string }> | undefined
          const delta = choices?.[0]?.delta
          const finishReason = choices?.[0]?.finish_reason

          if (delta?.content) {
            controller.enqueue(emit('content_block_delta', {
              type: 'content_block_delta', index: 0,
              delta: { type: 'text_delta', text: delta.content },
            }))
          }

          if (finishReason) {
            const usage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
            controller.enqueue(emit('content_block_stop', { type: 'content_block_stop', index: 0 }))
            controller.enqueue(emit('message_delta', {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: usage?.completion_tokens ?? 0 },
            }))
          }
        }
      },
    }),
  )
}
