import type { Provider, OpenAIRequest } from './types'

type ForwardResult = {
  stream: ReadableStream<Uint8Array> | null
  json: unknown | null
  isStreaming: boolean
}

export async function forwardToProvider(
  provider: Provider,
  request: OpenAIRequest,
): Promise<ForwardResult> {
  const url = `${provider.endpoint}/chat/completions`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (provider.api_key) {
    headers['Authorization'] = `Bearer ${provider.api_key}`
  }

  // Rewrite model field to provider's expected model ID
  const forwardBody: OpenAIRequest = { ...request, model: provider.provider_model_id }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(forwardBody),
  })

  if (!response.ok) {
    const text = await response.text()
    throw Object.assign(
      new Error(`Provider error ${response.status}: ${text}`),
      { statusCode: response.status },
    )
  }

  if (request.stream) {
    if (!response.body) throw new Error('Provider returned no body for streaming request')
    return { stream: response.body, json: null, isStreaming: true }
  }

  const json = await response.json()
  return { stream: null, json, isStreaming: false }
}
