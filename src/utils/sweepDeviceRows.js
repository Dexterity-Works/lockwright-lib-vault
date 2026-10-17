import { pearpassVaultClient } from '../instances'

/**
 * Revoke and drop every roster row for one peer. Duplicate device/<id> rows
 * can exist for the same physical peer (e.g. a stale-name heal during
 * re-pair appended a fresh row while the original survived); a survivor
 * keeps the peer listed and sealable for the next epoch.
 *
 * Swept rows: every row sharing the primary's writerKey or masterTopic,
 * plus the primary row itself, minus rows carrying our own writerKey.
 * Order: every swept writer is revoked before any row is deleted, and the
 * primary row goes last, so a sweep that throws part way still finds the
 * primary row on retry.
 *
 * The primary need not be in `devices` (a retry after its row was dropped
 * passes the peer record); then only the duplicates are swept.
 *
 * @param {{
 *   primary: { id: string, writerKey?: string | null, masterTopic?: string | null },
 *   devices: Array<{ id?: string, writerKey?: string | null, masterTopic?: string | null }>,
 *   myWriterKey: string | null
 * }} params
 */
export const sweepDeviceRows = async ({ primary, devices, myWriterKey }) => {
  const isOwn = (d) => !!myWriterKey && d.writerKey === myWriterKey
  const matches = (d) =>
    (!!primary.writerKey && d.writerKey === primary.writerKey) ||
    (!!primary.masterTopic && d.masterTopic === primary.masterTopic)

  const primaryRow = devices.find((d) => d?.id === primary.id)
  const duplicates = devices.filter(
    (d) => d?.id && d.id !== primary.id && !isOwn(d) && matches(d)
  )
  const swept = primaryRow ? [...duplicates, primaryRow] : duplicates

  const writerKeys = new Set(
    swept.map((d) => d.writerKey).filter((k) => k && k !== myWriterKey)
  )
  for (const writerKey of writerKeys) {
    await pearpassVaultClient.activeVaultRemoveWriter(writerKey)
  }

  for (const id of new Set(duplicates.map((d) => d.id))) {
    await pearpassVaultClient.activeVaultRemove(`device/${id}`)
  }
  if (primaryRow) {
    await pearpassVaultClient.activeVaultRemove(`device/${primary.id}`)
  }
}
