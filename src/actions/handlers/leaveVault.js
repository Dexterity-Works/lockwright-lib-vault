import { getCurrentVault } from '../../api/getCurrentVault'
import { listDevices } from '../../api/listDevices'
import { pearpassVaultClient } from '../../instances'
import { logger } from '../../utils/logger'
import { sweepDeviceRows } from '../../utils/sweepDeviceRows'

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
    const myWriterKey = await pearpassVaultClient.activeVaultGetWriterKey()
    const actorDevice = devices.find((d) => d?.id === actorId)
    if (actorDevice) {
      logSkippedRevoke(actorDevice, myWriterKey)
    }
    // A missing row is a retry after a rotation threw past the removal.
    // Sweep from the peer record so late duplicates still go, then rotate,
    // or the inbox drops the entry and the leaver keeps reading.
    const primary = actorDevice ?? (await peerRecord(actorId))
    await sweepDeviceRows({ primary, devices, myWriterKey })

    const epoch = await pearpassVaultClient.activeVaultEnsureEpoch({
      start: true
    })
    if (epoch?.rotated === true || epoch?.reason === 'current') return
    // Another member has to rotate; the core's update handler does it when
    // the key arrives. The rows are gone, so this leave is done.
    if (epoch?.reason === 'pending') {
      logger.log('leave-vault: rotation pending on another member', {
        actorId
      })
      return
    }
    throw new Error(
      `leave-vault: epoch rotation failed: ${epoch?.reason ?? 'no result'}`
    )
  }
}

const peerRecord = async (actorId) => {
  const peer = await pearpassVaultClient.vaultsGet?.(`peer/${actorId}`)
  return {
    id: actorId,
    writerKey: peer?.writerKey ?? null,
    masterTopic: peer?.masterTopic ?? null
  }
}

// The sweep revokes writers before dropping rows: the row is the only
// handle kickDevice has on a peer, so if revoke fails we throw (inbox
// retries) and the row stays kickable. It skips our own key: a row claiming
// it is not the leaver's to give up.
const logSkippedRevoke = (actorDevice, myWriterKey) => {
  if (!actorDevice.writerKey) {
    logger.error('leave-vault: actor has no writerKey; skipping removeWriter', {
      actorId: actorDevice.id
    })
  } else if (actorDevice.writerKey === myWriterKey) {
    logger.error('leave-vault: actor row carries our writerKey; not revoking', {
      actorId: actorDevice.id
    })
  }
}
