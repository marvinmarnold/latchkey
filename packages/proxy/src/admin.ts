import type { Database } from 'bun:sqlite'
import { createPublicClient, http, parseAbi } from 'viem'
import { baseSepolia, base } from 'viem/chains'

// --- Wallet state (Phase 2) ---

export type WalletStateRow = {
  address: string
  accrued_usd: number
  total_pulled_usd: number
  pull_failure_count: number
  last_pull_at: number | null
  last_pull_tx: string | null
  blocked: number
}

export function queryWallets(db: Database): WalletStateRow[] {
  return db
    .query<WalletStateRow, []>(
      `SELECT address, accrued_usd, total_pulled_usd, pull_failure_count, last_pull_at, last_pull_tx, blocked
       FROM wallet_state
       ORDER BY accrued_usd DESC`,
    )
    .all()
}

const ERC20_ABI = parseAbi(['function allowance(address owner, address spender) view returns (uint256)'])

export async function queryAllowance(owner: string): Promise<{ allowance_atomic: string }> {
  const billingContract = process.env.BILLING_CONTRACT_ADDRESS
  const usdcAddress = process.env.USDC_ADDRESS
  if (!billingContract || !usdcAddress) {
    return { allowance_atomic: '0' }
  }
  const rpcUrl = process.env.BASE_RPC_URL ?? 'https://sepolia.base.org'
  const chain = rpcUrl.includes('mainnet') && !rpcUrl.includes('sepolia') ? base : baseSepolia
  const client = createPublicClient({ chain, transport: http(rpcUrl) })
  const allowance = await client.readContract({
    address: usdcAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner as `0x${string}`, billingContract as `0x${string}`],
  })
  return { allowance_atomic: allowance.toString() }
}



export type UsageRow = { date: string; key: string; tokens: number }

export type UsageResult = {
  byWallet: UsageRow[]
  byProvider: UsageRow[]
  byModel: UsageRow[]
}

export function queryUsage(db: Database): UsageResult {
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400

  const byWallet = db
    .query<UsageRow, [number]>(
      `SELECT date(datetime(created_at, 'unixepoch')) AS date,
              caller_address AS key,
              SUM(input_tokens + output_tokens) AS tokens
       FROM billing_log
       WHERE created_at >= ?
       GROUP BY date, caller_address
       ORDER BY date`,
    )
    .all(cutoff)

  const byProvider = db
    .query<UsageRow, [number]>(
      `SELECT date(datetime(bl.created_at, 'unixepoch')) AS date,
              p.name AS key,
              SUM(bl.input_tokens + bl.output_tokens) AS tokens
       FROM billing_log bl
       JOIN listings l ON l.id = bl.listing_id
       JOIN providers p ON p.id = l.provider_id
       WHERE bl.created_at >= ?
       GROUP BY date, p.name
       ORDER BY date`,
    )
    .all(cutoff)

  const byModel = db
    .query<UsageRow, [number]>(
      `SELECT date(datetime(created_at, 'unixepoch')) AS date,
              model_id AS key,
              SUM(input_tokens + output_tokens) AS tokens
       FROM billing_log
       WHERE created_at >= ?
       GROUP BY date, model_id
       ORDER BY date`,
    )
    .all(cutoff)

  return { byWallet, byProvider, byModel }
}
