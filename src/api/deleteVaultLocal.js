import { ACTION_TYPES } from '../actions'
import { pearpassVaultClient } from '../instances'
import { broadcastAction } from './broadcastAction'
import { getCurrentVault } from './getCurrentVault'
import { listVaults } from './listVaults'
import { getMyDeviceId } from '../utils/getMyDeviceId'
import { logger } from '../utils/logger'
import { clearRevoked, isRevoked } from '../utils/revocationGuard'

// The leave goes to the active vault's roster with this device's id in it,
// so a leave for any other vault would reach the wrong devices.
export class VaultNotActiveError extends Error {
  /** @param {string} vaultId */
  constructor(vaultId) {
    super('deleteVaultLocal: vault is not the active vault')
    this.name = 'VaultNotActiveError'
    this.vaultId = vaultId
  }
}

/**
 * Removes a vault from this device. Before wiping locally, broadcasts a
 * leave-vault envelope so each paired device removes us from their
 * device list; offline peers receive the envelope from the outbox the
 * next time they come online. Only the active vault can be left; a vault
 * this device was revoked from is wiped without a leave, active or not.
 *
 * @param {string} vaultId
 * @throws {VaultNotActiveError} when the vault is neither active nor revoked
 * @returns {Promise<Array<any>>} the remaining vaults after deletion.
 */
export const deleteVaultLocal = async (vaultId) => {
  if (!vaultId) {
    throw new Error('vaultId is required')
  }

  const revoked = isRevoked(vaultId)
  if (!revoked && (await getCurrentVault())?.id !== vaultId) {
    throw new VaultNotActiveError(vaultId)
  }

  // Skip the leave broadcast when our own device entry is no longer in
  // autobase. That happens when this call is triggered by vault-access-revoked
  // after a kick: the kicker already removed our writer and our device row,
  // so broadcastAction's getMyDeviceId check would throw and there is no
  // peer left to inform anyway. A revoked vault has no one to tell either.
  const myDeviceId = revoked ? null : await getMyDeviceId().catch(() => null)
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
