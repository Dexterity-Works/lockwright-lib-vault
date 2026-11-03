import { processInbox } from './inbox'
import { processOutbox } from './outbox'
import { logger } from '../utils/logger'

let isProcessing = false
let pendingRescan = false
// One timer for the earliest inbox entry waiting out its retry delay.
let retryTimer = null

/** @returns {Promise<void>} */
export const runActionScan = async () => {
  if (isProcessing) {
    pendingRescan = true
    return
  }

  isProcessing = true
  try {
    do {
      pendingRescan = false

      try {
        const { nextDueAt } = (await processInbox()) ?? {}
        clearTimeout(retryTimer)
        retryTimer = Number.isFinite(nextDueAt)
          ? setTimeout(runActionScan, Math.max(0, nextDueAt - Date.now()))
          : null
      } catch (err) {
        logger.error('runActionScan: processInbox failed', err)
      }

      try {
        await processOutbox()
      } catch (err) {
        logger.error('runActionScan: processOutbox failed', err)
      }
    } while (pendingRescan)
  } finally {
    isProcessing = false
  }
}
