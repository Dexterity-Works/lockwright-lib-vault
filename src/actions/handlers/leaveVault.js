import { getCurrentVault } from '../../api/getCurrentVault'
import { listDevices } from '../../api/listDevices'
import { pearpassVaultClient } from '../../instances'
import { logger } from '../../utils/logger'

// Defer when the target vault isn't active; we can only write to the
// active vault.
export const leaveVaultActionHandler = {
  execute: async (action) => {
    const vaultId = action?.payload?.vaultId
    const actorId = action?.actor
    if (!vaultId || !actorId) {
      throw new Error('leave-vault action: vaultId and actor are required')
    }

    const currentVault = await getCurrentVault()
    if (currentVault?.id !== vaultId) {
      return { status: 'deferred', reason: 'vault-not-active' }
    }

    const devices = (await listDevices()) ?? []
    const actorDevice = devices.find((d) => d?.id === actorId)
    if (!actorDevice) return

    // Revoke the writer before dropping the row. The row is the only handle
    // kickDevice has on a peer, so if revoke fails we throw (inbox retries)
    // and the row stays kickable. Dropping the row alone left a hidden peer
    // that could still append. Skip our own key: a row claiming it is not
    // the leaver's to give up.
    const writerKey = actorDevice.writerKey
    const myWriterKey = await pearpassVaultClient.activeVaultGetWriterKey()
    if (!writerKey) {
      logger.error(
        'leave-vault: actor has no writerKey; skipping removeWriter',
        { actorId }
      )
    } else if (writerKey === myWriterKey) {
      logger.error(
        'leave-vault: actor row carries our writerKey; not revoking',
        { actorId }
      )
    } else {
      await pearpassVaultClient.activeVaultRemoveWriter(writerKey)
    }

    await pearpassVaultClient.activeVaultRemove(`device/${actorId}`)
  }
}
