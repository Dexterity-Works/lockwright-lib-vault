/**
 * Shape a vault for the device-local master catalog (`vault/<id>`).
 *
 * The catalog keeps only { ciphertext, nonce, salt } for a protected vault.
 * encryption.hashedPassword is the key that unwraps the vault key, so it
 * must come from the vault password and never sit next to the ciphertext.
 *
 * @param {Object} vault
 * @returns {Object}
 */
export const toCatalogVault = (vault) => {
  if (!vault?.encryption) return vault

  const { ciphertext, nonce, salt } = vault.encryption

  return { ...vault, encryption: { ciphertext, nonce, salt } }
}
