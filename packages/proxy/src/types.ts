// packages/proxy/src/types.ts

// --- Auth ---

export type BearerToken = {
  address: `0x${string}`
  expiry: number      // Unix timestamp seconds
  nonce: string       // Random string, prevents replay
  sig: `0x${string}` // EIP-712 signature
}

// --- Providers ---

export type ProviderType = 'self_hosted' | 'api_delegating'

export type Provider = {
  id: string
  hf_repo_id: string         // e.g. "deepseek-ai/DeepSeek-V3"
  provider_model_id: string  // model name sent to provider (e.g. "deepseek-chat")
  endpoint: string           // base URL, e.g. "https://api.deepseek.com/v1"
  type: ProviderType
  api_key: string | null     // plaintext in MVP; null for self_hosted
  price_input: number        // USDC micro-units per 1M input tokens
  price_output: number       // USDC micro-units per 1M output tokens
  ctx_length: number | null
  quantization: string | null
  reliability: number        // 0–1
  active: number             // 1 = active, 0 = inactive
}

// --- OpenAI API format (internal canonical format) ---

export type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OpenAIRequest = {
  model: string
  messages: OpenAIMessage[]
  max_tokens?: number
  temperature?: number
  stream?: boolean
}

export type OpenAIResponseChoice = {
  index: number
  message: { role: string; content: string }
  finish_reason: string
}

export type OpenAIUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export type OpenAIResponse = {
  id: string
  object: string
  model: string
  choices: OpenAIResponseChoice[]
  usage: OpenAIUsage
}

// --- Anthropic API format ---

export type AnthropicContentBlock = { type: 'text'; text: string }

export type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export type AnthropicRequest = {
  model: string
  messages: AnthropicMessage[]
  system?: string
  max_tokens: number
  temperature?: number
  stream?: boolean
}

export type AnthropicUsage = {
  input_tokens: number
  output_tokens: number
}

export type AnthropicResponse = {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: AnthropicContentBlock[]
  stop_reason: string | null
  stop_sequence: string | null
  usage: AnthropicUsage
}

// --- Billing ---

export type UsageRecord = {
  callerAddress: string
  providerId: string
  hfRepoId: string
  inputTokens: number
  outputTokens: number
  costUsdc: number  // micro-units (1 USDC = 1_000_000)
}
