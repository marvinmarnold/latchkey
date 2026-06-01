import { createConfig } from '@ponder/core'
import { http } from 'viem'
import { LatchkeyBillingAbi } from './src/abi'

const contractAddress = (process.env.BILLING_CONTRACT_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
const rpcUrl = process.env.INDEXER_RPC_URL ?? process.env.BASE_RPC_URL ?? 'https://sepolia.base.org'
const startBlock = Number(process.env.INDEXER_START_BLOCK ?? 0)

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
