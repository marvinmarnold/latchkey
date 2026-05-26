// packages/proxy/src/middleware/auth.ts
import { recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { randomBytes } from 'crypto'
import type { BearerToken } from '../types'

export const DOMAIN = {
  name: 'Payprompt LLM Marketplace',
  version: '1',
  chainId: 8453,
} as const

export const BEARER_TYPES = {
  BearerToken: [
    { name: 'address', type: 'address' },
    { name: 'expiry', type: 'uint256' },
    { name: 'nonce', type: 'string' },
  ],
} as const

export async function verifyBearerToken(encoded: string): Promise<`0x${string}`> {
  let token: BearerToken
  try {
    token = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  } catch {
    throw new Error('Malformed token')
  }

  if (!token.address || !token.expiry || !token.nonce || !token.sig) {
    throw new Error('Missing token fields')
  }

  if (token.expiry < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired')
  }

  const recovered = await recoverTypedDataAddress({
    domain: DOMAIN,
    types: BEARER_TYPES,
    primaryType: 'BearerToken',
    message: {
      address: token.address,
      expiry: BigInt(token.expiry),
      nonce: token.nonce,
    },
    signature: token.sig,
  })

  if (recovered.toLowerCase() !== token.address.toLowerCase()) {
    throw new Error('Invalid signature')
  }

  return recovered
}

export async function encodeBearerToken(
  privateKey: `0x${string}`,
  expiry: number = Math.floor(Date.now() / 1000) + 3600,
): Promise<string> {
  const account = privateKeyToAccount(privateKey)
  const nonce = randomBytes(16).toString('hex')

  const sig = await account.signTypedData({
    domain: DOMAIN,
    types: BEARER_TYPES,
    primaryType: 'BearerToken',
    message: { address: account.address, expiry: BigInt(expiry), nonce },
  })

  const token: BearerToken = { address: account.address, expiry, nonce, sig }
  return Buffer.from(JSON.stringify(token)).toString('base64')
}

export function extractTokenFromRequest(request: Request): string {
  const auth = request.headers.get('authorization') ?? request.headers.get('x-api-key') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : auth
}
