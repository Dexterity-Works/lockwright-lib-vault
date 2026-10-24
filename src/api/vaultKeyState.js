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
