#!/usr/bin/env bun
/**
 * Generates a bearer token from TEST_PRIVATE_KEY and makes a test inference request.
 *
 * Usage:
 *   bun scripts/test-inference.ts
 *   bun scripts/test-inference.ts --anthropic      # use /v1/messages instead
 *   bun scripts/test-inference.ts --stream         # streaming mode
 *   bun scripts/test-inference.ts --model deepseek-ai/DeepSeek-V3
 */

import { encodeBearerToken } from '../packages/proxy/src/middleware/auth'

const BASE_URL = `http://localhost:${process.env.PORT ?? 3000}`
const rawKey = process.env.TEST_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? ''
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`
const MODEL = getArg('--model') ?? 'deepseek-ai/DeepSeek-V3'
const USE_ANTHROPIC = process.argv.includes('--anthropic')
const STREAMING = process.argv.includes('--stream')

if (!rawKey) {
  console.error('TEST_PRIVATE_KEY is not set. Copy .env.example to .env and fill it in.')
  process.exit(1)
}

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}

async function main() {
  // Health check
  const health = await fetch(`${BASE_URL}/health`)
  if (!health.ok) {
    console.error(`Server not reachable at ${BASE_URL} — is it running?`)
    process.exit(1)
  }
  console.log('Health:', await health.json())

  // Generate token
  const token = await encodeBearerToken(PRIVATE_KEY)
  console.log('\nToken generated (first 40 chars):', token.slice(0, 40) + '...')
  console.log('\nToken generated:', token)

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  if (USE_ANTHROPIC) {
    const body = {
      model: MODEL,
      max_tokens: 100,
      stream: STREAMING,
      messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
    }
    console.log(`\nPOST ${BASE_URL}/v1/messages (model: ${MODEL})`)
    const res = await fetch(`${BASE_URL}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(body) })
    await printResponse(res)
  } else {
    const body = {
      model: MODEL,
      stream: STREAMING,
      messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
    }
    console.log(`\nPOST ${BASE_URL}/v1/chat/completions (model: ${MODEL})`)
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) })
    await printResponse(res)
  }
}

async function printResponse(res: Response) {
  console.log('Status:', res.status)
  if (STREAMING) {
    console.log('\n--- stream ---')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      process.stdout.write(decoder.decode(value))
    }
    console.log('\n--- end ---')
  } else {
    const json = await res.json()
    console.log(JSON.stringify(json, null, 2))
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
