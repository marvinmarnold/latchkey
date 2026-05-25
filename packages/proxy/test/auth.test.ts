// packages/proxy/test/auth.test.ts
import { describe, it, expect } from 'bun:test'
import { verifyBearerToken, encodeBearerToken } from '../src/middleware/auth'
import { privateKeyToAccount } from 'viem/accounts'

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const

describe('auth', () => {
  it('verifies a valid bearer token', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY)
    const encoded = await encodeBearerToken(TEST_PRIVATE_KEY)
    const address = await verifyBearerToken(encoded)
    expect(address.toLowerCase()).toBe(account.address.toLowerCase())
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
