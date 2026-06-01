import { ponder } from '@ponder/core'

ponder.on('LatchkeyBilling:Pulled', async ({ event, context }) => {
  await context.db.PullEvent.create({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    data: {
      caller:       event.args.caller,
      gross_atomic: event.args.gross,
      fee_atomic:   event.args.fee,
      tx_hash:      event.transaction.hash,
      block_time:   Number(event.block.timestamp),
    },
  })
})
