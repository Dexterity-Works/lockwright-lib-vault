import { pearpassVaultClient } from '../instances'

// A desktop or core older than epoch keys answers the epoch calls this way.
const UNKNOWN_COMMAND = /UNKNOWN_METHOD|Unknown command/

/**
 * A legacy vault has no epoch for other members to rotate: a removal cut
 * short before its rotation (lock, quit, a closed popup) would leave every
 * later write plaintext to the removed device. Starting the epoch while the
 * device is still a member lets any member rotate past the removal when it
 * syncs. Throws, before anything is removed, when the status cannot be read
 * or the epoch does not start. A core without epoch commands has nothing to
 * start; the caller's own rotation then reports the failure.
 *
 * @param {string} caller prefix for the error message
 */
export const startLegacyEpoch = async (caller) => {
  let status
  try {
    status = await pearpassVaultClient.activeVaultGetEpochStatus()
  } catch (error) {
    if (UNKNOWN_COMMAND.test(error?.message ?? '')) return
    throw error
  }
  if (status?.legacy !== true) return
  const started = await pearpassVaultClient.activeVaultEnsureEpoch({
    start: true
  })
  if (started?.rotated === true) return
  throw new Error(
    `${caller}: cannot start the vault key: ${started?.reason ?? 'no result'}`
  )
}
