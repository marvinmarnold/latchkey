import { createSchema } from '@ponder/core'

export default createSchema(p => ({
  PullEvent: p.createTable({
    // id: tx_hash-logIndex (unique per event)
    id:           p.string(),
    caller:       p.string(),
    // Stored in token atomic units (USDC = 6 decimals). Dashboard divides by 1e6 for display.
    gross_atomic: p.bigint(),
    fee_atomic:   p.bigint(),
    tx_hash:      p.string(),
    block_time:   p.int(),
  }),
}))
