// Vault ids this process has already emitted vault-access-revoked for, from
// any source (kick envelope or epoch status), so each vault gets one event.
const revokedVaultIds = new Set()

/**
 * @param {string} vaultId
 * @returns {boolean} true if newly marked
 */
export const markRevoked = (vaultId) => {
  if (revokedVaultIds.has(vaultId)) return false
  revokedVaultIds.add(vaultId)
  return true
}

/**
 * @param {string} vaultId
 */
export const clearRevoked = (vaultId) => {
  revokedVaultIds.delete(vaultId)
}

export const clearAllRevoked = () => {
  revokedVaultIds.clear()
}
