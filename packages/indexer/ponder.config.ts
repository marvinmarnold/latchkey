import { createConfig } from '@ponder/core'
import { http } from 'viem'
import { LatchkeyBillingAbi } from './src/abi'

const contractAddressEnv = process.env.BILLING_CONTRACT_ADDRESS as `0x${string}` | undefined
if (!contractAddressEnv || contractAddressEnv === '0x0000000000000000000000000000000000000000') {
  throw new Error('BILLING_CONTRACT_ADDRESS must be set to a deployed LatchkeyBilling address')
}
const contractAddress = contractAddressEnv
const rpcUrl = process.env.INDEXER_RPC_URL ?? process.env.BASE_RPC_URL ?? 'https://sepolia.base.org'
const startBlockRaw = process.env.INDEXER_START_BLOCK ?? '0'
const startBlock = Number(startBlockRaw)
if (!Number.isInteger(startBlock) || startBlock < 0) {
  throw new Error(`INDEXER_START_BLOCK must be a non-negative integer, got: ${startBlockRaw}`)
}

export default createConfig({
  networks: {
    baseSepolia: {
      chainId: 84532,
      transport: http(rpcUrl),
    },
  },
  contracts: {
    LatchkeyBilling: {
      abi: LatchkeyBillingAbi,
      address: contractAddress,
      network: 'baseSepolia',
      startBlock,
    },
  },
})
