// Vault ids this process has already emitted vault-access-revoked for, with
// the source that emitted, so each vault gets one event whether a kick or
// delete envelope or an epoch status reported it first.
/** @type {Map<string, 'kick' | 'epoch' | 'delete'>} */
const revokedVaultIds = new Map()

/**
 * @param {string} vaultId
 * @param {'kick' | 'epoch' | 'delete'} source
 * @returns {boolean} true if newly marked
 */
export const markRevoked = (vaultId, source) => {
  if (revokedVaultIds.has(vaultId)) return false
  revokedVaultIds.set(vaultId, source)
  return true
}

/** @param {string} vaultId */
export const isRevoked = (vaultId) => revokedVaultIds.has(vaultId)

/**
 * Only for a vault that was wiped, paired, or created, so a later
 * revocation is a new one.
 *
 * @param {string} vaultId
 */
export const clearRevoked = (vaultId) => {
  revokedVaultIds.delete(vaultId)
}

export const clearAllRevoked = () => {
  revokedVaultIds.clear()
}
