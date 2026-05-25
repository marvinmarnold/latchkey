// packages/proxy/src/middleware/balance.ts

/**
 * Returns the caller's USDC balance in micro-units (1 USDC = 1_000_000).
 * MVP: always returns a large balance. Phase 2 replaces with a Base RPC call.
 */
export async function getCallerBalance(_callerAddress: `0x${string}`): Promise<bigint> {
  return BigInt(1_000_000_000) // 1000 USDC — mock
}

export async function assertSufficientBalance(callerAddress: `0x${string}`): Promise<void> {
  const balance = await getCallerBalance(callerAddress)
  if (balance <= 0n) {
    throw Object.assign(new Error('Insufficient balance'), { statusCode: 402 })
  }
}
