import { createPublicClient, http, parseAbi } from 'viem'
import { baseSepolia, base } from 'viem/chains'
import { Connection, PublicKey } from '@solana/web3.js'
import type { Chain } from './auth'

const EVM_CONTRACT_ABI = parseAbi([
  'function balances(address) view returns (uint256)',
])

function getEvmClient() {
  const rpcUrl = process.env.BASE_RPC_URL ?? 'https://sepolia.base.org'
  const isMainnet = rpcUrl.includes('mainnet') && !rpcUrl.includes('sepolia')
  return createPublicClient({
    chain: isMainnet ? base : baseSepolia,
    transport: http(rpcUrl),
  })
}

// USDC mint on Solana (mainnet: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v, devnet: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU)
const SOLANA_USDC_MINT = process.env.SOLANA_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'

async function getSolanaUSDCBalance(walletAddress: string): Promise<bigint> {
  const connection = new Connection(SOLANA_RPC_URL, 'confirmed')
  const wallet = new PublicKey(walletAddress)
  const mint = new PublicKey(SOLANA_USDC_MINT)

  const accounts = await connection.getParsedTokenAccountsByOwner(wallet, { mint })
  if (accounts.value.length === 0) return 0n

  const amount = accounts.value[0]?.account?.data?.parsed?.info?.tokenAmount?.amount
  return amount ? BigInt(amount) : 0n
}

export async function getCallerBalance(callerAddress: string, chain: Chain = 'evm'): Promise<bigint> {
  if (chain === 'solana') {
    return getSolanaUSDCBalance(callerAddress)
  }

  // EVM: read from deposit contract
  const contractAddress = process.env.BALANCE_CONTRACT_ADDRESS as `0x${string}` | undefined
  if (!contractAddress) {
    // Phase 1 fallback: mock balance so the proxy works without a contract configured
    return BigInt(1_000_000_000)
  }
  const client = getEvmClient()
  return client.readContract({
    address: contractAddress,
    abi: EVM_CONTRACT_ABI,
    functionName: 'balances',
    args: [callerAddress as `0x${string}`],
  })
}

export async function assertSufficientBalance(callerAddress: string, chain: Chain = 'evm'): Promise<void> {
  const balance = await getCallerBalance(callerAddress, chain)
  if (balance <= 0n) {
    throw Object.assign(new Error('Insufficient balance'), { statusCode: 402 })
  }
}
