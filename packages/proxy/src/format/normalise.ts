import type { AnthropicRequest, OpenAIRequest, OpenAIMessage } from '../types'

export function normaliseAnthropicToOpenAI(req: AnthropicRequest): OpenAIRequest {
  const messages: OpenAIMessage[] = []

  if (req.system) {
    messages.push({ role: 'system', content: req.system })
  }

  for (const msg of req.messages) {
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : msg.content.map(b => (b.type === 'text' ? b.text : '')).join('')
    messages.push({ role: msg.role, content })
  }

  return {
    model: req.model,
    messages,
    max_tokens: req.max_tokens,
    temperature: req.temperature,
    stream: req.stream,
  }
}
