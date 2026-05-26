// packages/proxy/test/auth.test.ts
import { describe, it, expect } from 'bun:test'
import { verifyBearerToken, encodeBearerToken, encodeSolanaBearerToken } from '../src/middleware/auth'
import { privateKeyToAccount } from 'viem/accounts'

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

describe('auth — EVM', () => {
  it('verifies a valid EVM bearer token', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY)
    const encoded = await encodeBearerToken(TEST_PRIVATE_KEY)
    const { callerAddress, chain } = await verifyBearerToken(encoded)
    expect(callerAddress.toLowerCase()).toBe(account.address.toLowerCase())
    expect(chain).toBe('evm')
  })

  it('rejects an expired token', async () => {
    const encoded = await encodeBearerToken(TEST_PRIVATE_KEY, Math.floor(Date.now() / 1000) - 1)
    await expect(verifyBearerToken(encoded)).rejects.toThrow('expired')
  })

  it('rejects a tampered token', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY)
    const token = {
      address: account.address,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      nonce: 'test',
      sig: ('0x' + 'aa'.repeat(65)) as `0x${string}`
    }
    const encoded = Buffer.from(JSON.stringify(token)).toString('base64')
    await expect(verifyBearerToken(encoded)).rejects.toThrow()
  })
})

describe('auth — Solana', () => {
  it('verifies a valid Solana bearer token', async () => {
    // Generate a fresh ed25519 keypair from a deterministic seed
    const seed = new Uint8Array(32).fill(42)
    const encoded = await encodeSolanaBearerToken(seed)
    const { chain } = await verifyBearerToken(encoded)
    expect(chain).toBe('solana')
  })

  it('rejects a tampered Solana token', async () => {
    const seed = new Uint8Array(32).fill(7)
    const encoded = await encodeSolanaBearerToken(seed)
    const token = JSON.parse(Buffer.from(encoded, 'base64').toString())
    token.nonce = 'tampered'
    const bad = Buffer.from(JSON.stringify(token)).toString('base64')
    await expect(verifyBearerToken(bad)).rejects.toThrow('Invalid Solana signature')
  })
})
