import { onchainTable } from '@ponder/core'

// PullEvent indexed from LatchkeyBilling.Pulled(caller, gross, fee) events.
// gross_atomic and fee_atomic are stored as bigint (token atomic units).
// Dashboard divides by 1e6 (USDC_DECIMALS) to display in dollars.
export const pullEvent = onchainTable('pull_event', (p) => ({
  id:           p.text().primaryKey(),   // tx_hash-logIndex
  caller:       p.text().notNull(),
  gross_atomic: p.bigint().notNull(),
  fee_atomic:   p.bigint().notNull(),
  tx_hash:      p.text().notNull(),
  block_time:   p.integer().notNull(),
}))
