import { pearpassVaultClient } from '../../instances'
import { markRevoked } from '../../utils/revocationGuard'

// Receiver-side handling for KICK_DEVICE. The kicker has already addressed
// the envelope to a single target via broadcastAction's `targets` filter
// (and the personal-swarm transport routes by masterTopic, which is unique
// per device), so we trust that delivery here implies we are the target.
// An active-vault-scoped self-check would be wrong: the kicked vault might
// not be the currently active one, in which case activeVaultGetWriterKey
// returns a different writerKey and the check incorrectly fails.
//
// Defer until the app attaches a vault-access-revoked listener so boot-
// time delivery doesn't burn inbox attempts. One event per vault per
// process, shared with the epoch-status hook.
export const kickDeviceActionHandler = {
  execute: async (action) => {
    const vaultId = action?.payload?.vaultId
    const targetDeviceId = action?.payload?.targetDeviceId
    if (!vaultId || !targetDeviceId) {
      throw new Error(
        'kick-device action: payload.vaultId and payload.targetDeviceId are required'
      )
    }

    if (pearpassVaultClient.listenerCount?.('vault-access-revoked') === 0) {
      return { status: 'deferred', reason: 'no-listener' }
    }
    if (!markRevoked(vaultId, 'kick')) return
    pearpassVaultClient.emit('vault-access-revoked', {
      vaultId,
      actor: action?.actor
    })
  }
}
