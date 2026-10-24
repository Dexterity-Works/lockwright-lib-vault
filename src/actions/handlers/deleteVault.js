import { pearpassVaultClient } from '../../instances'
import { markRevoked } from '../../utils/revocationGuard'

// Defer until the app attaches a 'vault-access-revoked' listener so
// boot-time delivery doesn't burn inbox attempts. The mark lets the wipe
// skip the leave, which the vault's other devices do not need.
export const deleteVaultActionHandler = {
  execute: async (action) => {
    const vaultId = action?.payload?.vaultId
    if (!vaultId) {
      throw new Error('delete-vault action: payload.vaultId is required')
    }
    if (pearpassVaultClient.listenerCount?.('vault-access-revoked') === 0) {
      return { status: 'deferred', reason: 'no-listener' }
    }
    if (!markRevoked(vaultId, 'delete')) return
    pearpassVaultClient.emit('vault-access-revoked', {
      vaultId,
      actor: action?.actor
    })
  }
}
