import { recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { randomBytes } from 'crypto'
import * as ed from '@noble/ed25519'
import bs58 from 'bs58'
import type { BearerToken } from '../types'

export const DOMAIN = {
  name: 'Latchkey LLM Marketplace',
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

export type Chain = 'evm' | 'solana'

function isEVMAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

function isSolanaAddress(addr: string): boolean {
  // base58-encoded 32-byte public key → 32-44 chars, no 0x prefix
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)
}

/** Canonical message bytes for Solana tokens (signed with ed25519) */
function solanaSigningPayload(address: string, expiry: number, nonce: string): Uint8Array {
  return new TextEncoder().encode(
    `latchkey:${address}:${expiry}:${nonce}`,
  )
}

export async function verifyBearerToken(encoded: string): Promise<{ callerAddress: string; chain: Chain }> {
  // Strip the API-key prefix whether it arrives via extractTokenFromRequest or a direct call.
  const payload = encoded.startsWith(TOKEN_PREFIX) ? encoded.slice(TOKEN_PREFIX.length) : encoded
  let token: BearerToken
  try {
    token = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  } catch {
    throw new Error('Malformed token')
  }

  if (!token.address || !token.expiry || !token.nonce || !token.sig) {
    throw new Error('Missing token fields')
  }

  if (token.expiry < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired')
  }

  if (isEVMAddress(token.address)) {
    const recovered = await recoverTypedDataAddress({
      domain: DOMAIN,
      types: BEARER_TYPES,
      primaryType: 'BearerToken',
      message: {
        address: token.address,
        expiry: BigInt(token.expiry),
        nonce: token.nonce,
      },
      signature: token.sig as `0x${string}`,
    })
    if (recovered.toLowerCase() !== token.address.toLowerCase()) {
      throw new Error('Invalid signature')
    }
    return { callerAddress: recovered, chain: 'evm' }
  }

  // Solana rail disabled — phase 1 is EVM-only
  // Re-enable when SOLANA_ENABLED=true is set and phase 5 is active
  if (isSolanaAddress(token.address)) {
    throw new Error('Solana auth is not enabled (EVM only)')
  }

  throw new Error('Unknown address format — expected EVM 0x... or Solana base58 pubkey')
}

/** Generate an EVM bearer token (EIP-712). */
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
  return TOKEN_PREFIX + Buffer.from(JSON.stringify(token)).toString('base64')
}

/** Generate a Solana bearer token (ed25519). secretKey is the 64-byte keypair or 32-byte seed. */
export async function encodeSolanaBearerToken(
  secretKey: Uint8Array,
  expiry: number = Math.floor(Date.now() / 1000) + 3600,
): Promise<string> {
  const privKey = secretKey.length === 64 ? secretKey.slice(0, 32) : secretKey
  const pubKey = await ed.getPublicKeyAsync(privKey)
  const address = bs58.encode(pubKey)
  const nonce = randomBytes(16).toString('hex')
  const message = solanaSigningPayload(address, expiry, nonce)
  const sig = bs58.encode(await ed.signAsync(message, privKey))
  const token: BearerToken = { address, expiry, nonce, sig }
  return TOKEN_PREFIX + Buffer.from(JSON.stringify(token)).toString('base64')
}

/** Prefix added to all tokens so Claude Code and other tools treat them as API keys. */
export const TOKEN_PREFIX = 'sk-ant-api03-'

export function extractTokenFromRequest(request: Request): string {
  const auth = request.headers.get('authorization') ?? request.headers.get('x-api-key') ?? ''
  const raw = auth.startsWith('Bearer ') ? auth.slice(7) : auth
  // Strip the API key prefix if present before decoding the payload.
  return raw.startsWith(TOKEN_PREFIX) ? raw.slice(TOKEN_PREFIX.length) : raw
}
