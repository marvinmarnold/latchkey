import type { Listing, OpenAIRequest, AnthropicRequest } from './types'
import { translateOpenAIToAnthropic } from './format/translate'

type ForwardResult = {
  stream: ReadableStream<Uint8Array> | null
  json: unknown | null
  isStreaming: boolean
}

export async function forwardToProvider(
  listing: Listing,
  request: OpenAIRequest,
  callerModelId: string,
): Promise<ForwardResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  // Resolve the model name to send upstream:
  // - exact listings may rewrite to provider_model_id
  // - prefix listings pass the caller's model through
  const upstreamModel = listing.provider_model_id ?? callerModelId

  if (listing.upstream_format === 'anthropic') {
    return forwardAnthropic(listing, request, upstreamModel, headers)
  }

  return forwardOpenAI(listing, request, upstreamModel, headers)
}

async function forwardOpenAI(
  listing: Listing,
  request: OpenAIRequest,
  upstreamModel: string,
  headers: Record<string, string>,
): Promise<ForwardResult> {
  if (listing.api_key) headers['Authorization'] = `Bearer ${listing.api_key}`

  const body: OpenAIRequest = { ...request, model: upstreamModel }
  const response = await fetch(`${listing.endpoint}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) await throwUpstreamError(response)

  if (request.stream) {
    if (!response.body) throw new Error('Provider returned no body for streaming request')
    return { stream: response.body, json: null, isStreaming: true }
  }

  return { stream: null, json: await response.json(), isStreaming: false }
}

async function forwardAnthropic(
  listing: Listing,
  request: OpenAIRequest,
  upstreamModel: string,
  headers: Record<string, string>,
): Promise<ForwardResult> {
  if (listing.api_key) headers['x-api-key'] = listing.api_key
  headers['anthropic-version'] = '2023-06-01'

  const anthropicBody: AnthropicRequest = {
    model: upstreamModel,
    messages: request.messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    system: request.messages.find(m => m.role === 'system')?.content,
    max_tokens: request.max_tokens ?? 4096,
    ...(request.temperature !== undefined && { temperature: request.temperature }),
    ...(request.stream && { stream: true }),
  }

  const response = await fetch(`${listing.endpoint}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(anthropicBody),
  })

  if (!response.ok) await throwUpstreamError(response)

  if (request.stream) {
    if (!response.body) throw new Error('Provider returned no body for streaming request')
    return { stream: response.body, json: null, isStreaming: true }
  }

  // Convert Anthropic response back to OpenAI format (internal canonical)
  const anthropicJson = await response.json()
  return { stream: null, json: translateAnthropicToOpenAI(anthropicJson), isStreaming: false }
}

async function throwUpstreamError(response: Response): Promise<never> {
  const text = await response.text()
  throw Object.assign(
    new Error(`Provider error ${response.status}: ${text}`),
    { statusCode: response.status },
  )
}

function translateAnthropicToOpenAI(res: {
  id: string
  model: string
  content: Array<{ type: string; text: string }>
  stop_reason: string | null
  usage: { input_tokens: number; output_tokens: number }
}) {
  return {
    id: res.id,
    object: 'chat.completion',
    model: res.model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: res.content.map(b => b.text).join('') },
      finish_reason: res.stop_reason ?? 'stop',
    }],
    usage: {
      prompt_tokens: res.usage.input_tokens,
      completion_tokens: res.usage.output_tokens,
      total_tokens: res.usage.input_tokens + res.usage.output_tokens,
    },
  }
}
