import { pearpassVaultClient } from '../instances'
import { listDevices } from './listDevices'

/**
 * The active vault's key, for showing revocations: when the latest epoch was
 * written, and the devices it still seals to that are off the roster. Those
 * are removed (kicked or left) but can read new items until the key rotates.
 * Their rows are gone, so names come from the peer registry.
 *
 * @returns {Promise<{
 *   vaultId: string
 *   epoch: string | null
 *   legacy: boolean
 *   canRead: boolean
 *   members: string[]
 *   rotatedAt: number | null
 *   removed: Array<{ id: string, name: string | null }>
 * } | null>}
 */
export const getVaultKeyState = async () => {
  const status = await pearpassVaultClient.activeVaultGetEpochStatus()
  if (!status?.vaultId) return null

  const roster = new Set(((await listDevices()) ?? []).map((d) => d?.id))
  // The roster is read on whatever vault is active by now: another vault's
  // ids would all look removed.
  const after = await pearpassVaultClient.activeVaultGetEpochStatus()
  if (after?.vaultId !== status.vaultId) return null
  const members = Array.isArray(status.members) ? status.members : []
  const removedIds = members.filter((id) => !roster.has(id))
  const orNull = async (read) => {
    try {
      return await read()
    } catch {
      return null
    }
  }
  const [record, ...peers] = await Promise.all([
    status.epoch
      ? orNull(() =>
          pearpassVaultClient.activeVaultGet(`epoch/${status.epoch}`)
        )
      : null,
    ...removedIds.map((id) =>
      orNull(() => pearpassVaultClient.vaultsGet(`peer/${id}`))
    )
  ])

  return {
    vaultId: status.vaultId,
    epoch: status.epoch ?? null,
    legacy: status.legacy === true,
    canRead: status.canRead === true,
    members,
    rotatedAt: Number.isFinite(record?.createdAt) ? record.createdAt : null,
    removed: removedIds.map((id, i) => ({ id, name: peers[i]?.name ?? null }))
  }
}

// The key has rotated past a removed device when this vault's latest epoch
// leaves it out and seals only to the roster: a member that rotated from an
// older view can still seal to a duplicate row of the same peer.
const rotatedPast = (state, vaultId, deviceId) =>
  state?.vaultId === vaultId &&
  !!state.epoch &&
  !state.legacy &&
  !state.members.includes(deviceId) &&
  state.removed.length === 0

/**
 * Resolves with the key state once the vault's key has rotated past the
 * device, or null at the deadline or on abort. Reads now, then again on
 * each epoch-status for the vault (the push may carry only the vault id).
 *
 * @param {{ vaultId: string, deviceId: string, timeoutMs: number,
 *   signal?: AbortSignal }} params
 */
export const waitForKeyRotation = ({ vaultId, deviceId, timeoutMs, signal }) =>
  new Promise((resolve) => {
    let done = false
    const finish = (state) => {
      if (done) return
      done = true
      clearTimeout(timer)
      pearpassVaultClient.off?.('epoch-status', onStatus)
      signal?.removeEventListener('abort', onAbort)
      resolve(state)
    }
    const check = async () => {
      try {
        const state = await getVaultKeyState()
        if (rotatedPast(state, vaultId, deviceId)) finish(state)
      } catch {}
    }
    const onStatus = (status) => {
      if (status?.vaultId === vaultId) check()
    }
    const onAbort = () => finish(null)
    const timer = setTimeout(onAbort, timeoutMs)
    signal?.addEventListener('abort', onAbort)
    pearpassVaultClient.on?.('epoch-status', onStatus)
    if (signal?.aborted) onAbort()
    else check()
  })
