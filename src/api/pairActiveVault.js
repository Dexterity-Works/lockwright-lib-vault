import { pearpassVaultClient } from '../instances'
import { getMasterPasswordEncryption } from './getMasterPasswordEncryption'
import { listVaults } from './listVaults'
import { toCatalogVault } from '../utils/toCatalogVault'

/**
 * @param {string} inviteCode
 * @returns {Promise<string>}
 */
export const pairActiveVault = async (inviteCode) => {
  const masterEncryption = await getMasterPasswordEncryption()

  const masterEncryptionKey = await pearpassVaultClient.decryptVaultKey({
    hashedPassword: masterEncryption.hashedPassword,
    ciphertext: masterEncryption.ciphertext,
    nonce: masterEncryption.nonce
  })

  if (!masterEncryptionKey) {
    throw new Error('Failed to decrypt vault key for pairing')
  }

  // The invite is `<vaultId>/<autopassInvite>` and the sender picks the id.
  // Core pairs into vault/<vaultId> on disk and we write vault/<vaultId> in
  // the catalog, so an id we already hold would clobber that vault. Refuse
  // before core touches the store.
  const [inviteVaultId] = String(inviteCode).split('/')
  const vaults = (await listVaults()) ?? []

  if (vaults.some((vault) => vault.id === inviteVaultId)) {
    throw new Error('Vault already exists on this device')
  }

  const { vaultId, encryptionKey } =
    await pearpassVaultClient.pairActiveVault(inviteCode)

  await pearpassVaultClient.activeVaultInit({ id: vaultId, encryptionKey })

  const vault = await pearpassVaultClient.activeVaultGet(`vault`)

  await pearpassVaultClient.vaultsAdd(`vault/${vaultId}`, toCatalogVault(vault))

  return vaultId
}
