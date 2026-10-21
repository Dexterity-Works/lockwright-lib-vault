// Vault ids this process has already emitted vault-access-revoked for, with
// the source that emitted, so each vault gets one event whether a kick
// envelope or an epoch status reported it first.
/** @type {Map<string, 'kick' | 'epoch'>} */
const revokedVaultIds = new Map()

/**
 * @param {string} vaultId
 * @param {'kick' | 'epoch'} source
 * @returns {boolean} true if newly marked
 */
export const markRevoked = (vaultId, source) => {
  if (revokedVaultIds.has(vaultId)) return false
  revokedVaultIds.set(vaultId, source)
  return true
}

/**
 * With a `source`, clear only a mark that source left: a not-revoked epoch
 * status must not undo a kick, the kick envelope is the stronger signal.
 * Without one, clear any mark: the vault was wiped, paired, or created, so
 * a later revocation is a new one.
 *
 * @param {string} vaultId
 * @param {'kick' | 'epoch'} [source]
 */
export const clearRevoked = (vaultId, source) => {
  if (source && revokedVaultIds.get(vaultId) !== source) return
  revokedVaultIds.delete(vaultId)
}

export const clearAllRevoked = () => {
  revokedVaultIds.clear()
}
