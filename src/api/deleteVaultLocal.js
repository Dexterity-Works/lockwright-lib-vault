import { ACTION_TYPES } from '../actions'
import { pearpassVaultClient } from '../instances'
import { broadcastAction } from './broadcastAction'
import { listVaults } from './listVaults'
import { getMyDeviceId } from '../utils/getMyDeviceId'
import { logger } from '../utils/logger'
import { clearRevoked } from '../utils/revocationGuard'

/**
 * Removes a vault from this device. Before wiping locally, broadcasts a
 * leave-vault envelope so each paired device removes us from their
 * device list; offline peers receive the envelope from the outbox the
 * next time they come online.
 *
 * @param {string} vaultId
 * @returns {Promise<Array<any>>} the remaining vaults after deletion.
 */
export const deleteVaultLocal = async (vaultId) => {
  if (!vaultId) {
    throw new Error('vaultId is required')
  }

  // Skip the leave broadcast when our own device entry is no longer in
  // autobase. That happens when this call is triggered by vault-access-revoked
  // after a kick: the kicker already removed our writer and our device row,
  // so broadcastAction's getMyDeviceId check would throw and there is no
  // peer left to inform anyway.
  const myDeviceId = await getMyDeviceId().catch(() => null)
  if (myDeviceId) {
    try {
      await broadcastAction({
        type: ACTION_TYPES.LEAVE_VAULT,
        payload: { vaultId }
      })
    } catch (err) {
      logger.error('deleteVaultLocal: leave broadcast failed', {
        err: err?.message ?? String(err)
      })
    }
  }

  await pearpassVaultClient.removeVault(vaultId)
  clearRevoked(vaultId)

  return listVaults()
}
