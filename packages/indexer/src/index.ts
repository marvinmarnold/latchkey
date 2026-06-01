import { ponder } from '@ponder/core'
import { pullEvent } from '../ponder.schema'

ponder.on('LatchkeyBilling:Pulled', async ({ event, context }) => {
  await context.db.insert(pullEvent).values({
    id:           `${event.transaction.hash}-${event.log.logIndex}`,
    caller:       event.args.caller,
    gross_atomic: event.args.gross,
    fee_atomic:   event.args.fee,
    tx_hash:      event.transaction.hash,
    block_time:   Number(event.block.timestamp),
  })
})
