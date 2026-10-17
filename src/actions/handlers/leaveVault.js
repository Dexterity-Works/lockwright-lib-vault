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
    // A missing row is a retry after a rotation threw past the removal:
    // still rotate, or the inbox drops the entry and the leaver keeps reading.
    if (actorDevice) {
      await removeActorRows(actorDevice, devices)
    }

    const epoch = await pearpassVaultClient.activeVaultEnsureEpoch({
      start: true
    })
    if (epoch?.rotated === true || epoch?.reason === 'current') return
    // Another member has to rotate; it does so when it syncs the removal.
    if (epoch?.reason === 'pending') {
      return { status: 'deferred', reason: 'epoch-pending' }
    }
    throw new Error(
      `leave-vault: epoch rotation failed: ${epoch?.reason ?? 'no result'}`
    )
  }
}

// Revoke the writer before dropping the row. The row is the only handle
// kickDevice has on a peer, so if revoke fails we throw (inbox retries)
// and the row stays kickable. Dropping the row alone left a hidden peer
// that could still append. Skip our own key: a row claiming it is not
// the leaver's to give up.
//
// Then drop every row for the same peer (same writerKey or masterTopic),
// as kickDevice does: a duplicate row would keep the leaver sealable.
const removeActorRows = async (actorDevice, devices) => {
  const { writerKey, masterTopic } = actorDevice
  const myWriterKey = await pearpassVaultClient.activeVaultGetWriterKey()
  const ownKey = writerKey && writerKey === myWriterKey
  if (!writerKey) {
    logger.error('leave-vault: actor has no writerKey; skipping removeWriter', {
      actorId: actorDevice.id
    })
  } else if (ownKey) {
    logger.error('leave-vault: actor row carries our writerKey; not revoking', {
      actorId: actorDevice.id
    })
  } else {
    await pearpassVaultClient.activeVaultRemoveWriter(writerKey)
  }

  const ids = new Set([actorDevice.id])
  for (const d of devices) {
    if (!d?.id || (myWriterKey && d.writerKey === myWriterKey)) continue
    const sameWriter = writerKey && d.writerKey === writerKey
    const sameTopic = masterTopic && d.masterTopic === masterTopic
    if (sameWriter || sameTopic) ids.add(d.id)
  }
  for (const id of ids) {
    await pearpassVaultClient.activeVaultRemove(`device/${id}`)
  }
}
