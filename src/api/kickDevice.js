import { ACTION_TYPES } from '../actions'
import { pearpassVaultClient } from '../instances'
import { broadcastAction } from './broadcastAction'
import { getCurrentVault } from './getCurrentVault'
import { listDevices } from './listDevices'
import { logger } from '../utils/logger'
import { startLegacyEpoch } from '../utils/startLegacyEpoch'
import { sweepDeviceRows } from '../utils/sweepDeviceRows'

// Marks a `failures` entry as a key rotation that did not happen, as opposed
// to an envelope or roster failure.
export const EPOCH_FAILURE_KIND = 'epoch'

// Rotation outcomes that are not failures: nothing to rotate, or another
// member rotates when it syncs the removal.
const EPOCH_OK_REASONS = ['current', 'pending']

/**
 * Revoke a peer's access to the currently active vault. Removes the peer
 * from the autobase writer set (protocol-level revocation), drops their
 * device/<id> index entry, and notifies the kicked device via personal
 * swarm so it can wipe its local copy even after losing replication.
 *
 * @param {{ vaultId: string, targetDeviceId: string }} params
 * @returns {Promise<{
 *   results: Array<{ targetDeviceId: string, channel: 'outbox' }>,
 *   failures: Array<{ targetDeviceId: string, error: Error, kind?: 'epoch' }>,
 *   epoch: object | null
 * }>}
 */
export const kickDevice = async ({ vaultId, targetDeviceId } = {}) => {
  if (!vaultId) {
    throw new Error('kickDevice: vaultId is required')
  }
  if (!targetDeviceId) {
    throw new Error('kickDevice: targetDeviceId is required')
  }

  const myWriterKey = await pearpassVaultClient.activeVaultGetWriterKey()
  if (!myWriterKey) {
    throw new Error('kickDevice: cannot resolve own writer key')
  }

  const devices = (await listDevices()) ?? []
  const target = devices.find((d) => d?.id === targetDeviceId)
  if (!target) {
    throw new Error('kickDevice: target device not found')
  }
  // Self-check by writerKey works even when our own device entry is
  // missing or stale (in which case getMyDeviceId would return null).
  if (target.writerKey && target.writerKey === myWriterKey) {
    throw new Error('kickDevice: cannot kick self')
  }

  // 0. Start a legacy vault's epoch while the target is still a member.
  await startLegacyEpoch('kickDevice')

  // 1. Send the envelope first, while the target's device record (and its
  //    masterTopic) is still in the local view. broadcastAction looks up
  //    the target's masterTopic via listDevices(), so after the autobase
  //    removals below the lookup would miss and no envelope would ship.
  //    On failure surface it as a partial-delivery so the autobase ops
  //    below still happen; the target then learns via autobase replication.
  let broadcastResult
  try {
    broadcastResult = await broadcastAction({
      type: ACTION_TYPES.KICK_DEVICE,
      payload: {
        vaultId,
        targetDeviceId,
        targetWriterKey: target.writerKey ?? null
      },
      targets: [targetDeviceId]
    })
  } catch (error) {
    logger.error(
      'kickDevice: envelope broadcast failed; relying on autobase to inform target',
      { err: error?.message ?? String(error) }
    )
    broadcastResult = {
      results: [],
      failures: [{ targetDeviceId, error }]
    }
  }

  // 2. Drop the writer at the protocol level so subsequent appends from the
  //    kicked peer are rejected. Tolerate legacy entries that pre-date the
  //    writerKey field by skipping with a warning. If autobase rejects the
  //    write (e.g. we ourselves were kicked mid-operation), surface it as
  //    a partial-delivery failure: the envelope already shipped and the
  //    target will wipe regardless of whether our local writer can append.
  try {
    if (!target.writerKey) {
      logger.error(
        'kickDevice: target has no writerKey; skipping removeWriter',
        { targetDeviceId }
      )
    }

    // Every step acts on whatever vault is active; another UI may have
    // switched it while the envelope went out.
    if ((await getCurrentVault())?.id !== vaultId) {
      throw new Error('kickDevice: the vault is no longer the active vault')
    }

    // 3. Drop every app-layer index entry for the same peer (same writerKey
    //    or masterTopic). A stranded row keeps appearing in the paired-
    //    devices list and keeps the kicked device sealable for the epoch.
    await sweepDeviceRows({ primary: target, devices, myWriterKey, vaultId })
  } catch (error) {
    logger.error(
      'kickDevice: autobase removal failed; envelope already in flight',
      { err: error?.message ?? String(error) }
    )
    return {
      results: broadcastResult.results,
      failures: [...broadcastResult.failures, { targetDeviceId, error }],
      epoch: null
    }
  }

  // 4. Rotate the vault key so the kicked device cannot read later writes.
  //    A rotation that did not happen is reported, not thrown: the kick
  //    itself already landed.
  const failures = [...broadcastResult.failures]
  let epoch = null
  try {
    epoch =
      (await pearpassVaultClient.activeVaultEnsureEpoch({ start: true })) ??
      null
    const reason =
      typeof epoch?.rotated !== 'boolean'
        ? 'no result'
        : !epoch.rotated && !EPOCH_OK_REASONS.includes(epoch.reason)
          ? epoch.reason
          : null
    if (reason) {
      failures.push({
        targetDeviceId,
        error: new Error(`epoch rotation failed: ${reason}`),
        kind: EPOCH_FAILURE_KIND
      })
    }
  } catch (error) {
    logger.error('kickDevice: epoch rotation failed', {
      err: error?.message ?? String(error)
    })
    failures.push({
      targetDeviceId,
      error: new Error(
        `epoch rotation failed: ${error?.message ?? String(error)}`,
        { cause: error }
      ),
      kind: EPOCH_FAILURE_KIND
    })
  }

  return { results: broadcastResult.results, failures, epoch }
}
