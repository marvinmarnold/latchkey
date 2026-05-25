import { describe, it, expect } from 'bun:test'
import { normaliseAnthropicToOpenAI } from '../src/format/normalise'
import { translateOpenAIToAnthropic, openAIStreamToAnthropicStream } from '../src/format/translate'
import type { AnthropicRequest } from '../src/types'
import type { OpenAIResponse } from '../src/types'

describe('normaliseAnthropicToOpenAI', () => {
  it('moves system field to first message', () => {
    const req: AnthropicRequest = {
      model: 'deepseek-ai/DeepSeek-V3',
      messages: [{ role: 'user', content: 'Hello' }],
      system: 'You are helpful',
      max_tokens: 100,
    }
    const result = normaliseAnthropicToOpenAI(req)
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful' })
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hello' })
  })

  it('flattens text content blocks to string', () => {
    const req: AnthropicRequest = {
      model: 'deepseek-ai/DeepSeek-V3',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      max_tokens: 100,
    }
    const result = normaliseAnthropicToOpenAI(req)
    expect(result.messages[0].content).toBe('Hello')
  })

  it('preserves model, max_tokens, stream, temperature', () => {
    const req: AnthropicRequest = {
      model: 'deepseek-ai/DeepSeek-V3',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 512,
      temperature: 0.7,
      stream: true,
    }
    const result = normaliseAnthropicToOpenAI(req)
    expect(result.model).toBe('deepseek-ai/DeepSeek-V3')
    expect(result.max_tokens).toBe(512)
    expect(result.temperature).toBe(0.7)
    expect(result.stream).toBe(true)
  })
})

describe('translateOpenAIToAnthropic (non-streaming)', () => {
  it('converts choices to content blocks', () => {
    const res: OpenAIResponse = {
      id: 'chatcmpl-abc',
      object: 'chat.completion',
      model: 'deepseek-chat',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }
    const result = translateOpenAIToAnthropic(res)
    expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }])
    expect(result.stop_reason).toBe('end_turn')
    expect(result.usage.input_tokens).toBe(10)
    expect(result.usage.output_tokens).toBe(5)
  })
})

describe('openAIStreamToAnthropicStream', () => {
  it('emits Anthropic SSE events from OpenAI SSE chunks', async () => {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const openAIChunks = [
      'data: {"id":"chatcmpl-1","model":"deepseek-chat","choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","model":"deepseek-chat","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","model":"deepseek-chat","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ]
    const source = new ReadableStream({
      start(c) { openAIChunks.forEach(ch => c.enqueue(encoder.encode(ch))); c.close() }
    })

    const translated = openAIStreamToAnthropicStream(source)
    const reader = translated.getReader()
    const chunks: string[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(decoder.decode(value))
    }
    const full = chunks.join('')
    expect(full).toContain('event: message_start')
    expect(full).toContain('event: content_block_delta')
    expect(full).toContain('"text":"Hi"')
    expect(full).toContain('event: message_stop')
  })
})
