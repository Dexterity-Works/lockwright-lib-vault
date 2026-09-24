import { pearpassVaultClient } from '../instances'
import { getMasterPasswordEncryption } from './getMasterPasswordEncryption'
import { listVaults } from './listVaults'

/**
 * @param {string} vaultId
 * @param {Object} [params]
 * @param {Uint8Array} [params.password]
 * @param {string} [params.ciphertext]
 * @param {string} [params.nonce]
 * @param {string} [params.hashedPassword]
 * @returns {Promise<void>}
 */
export const getVaultById = async (vaultId, params) => {
  const vaults = await listVaults()
  const catalogVault = vaults.find((vault) => vault.id === vaultId)

  if (!catalogVault) {
    throw new Error('Vault not found')
  }

  const { ciphertext, nonce, salt } = catalogVault.encryption || {}
  const isProtected = !!(ciphertext && nonce && salt)

  const res = await pearpassVaultClient.activeVaultGetStatus()

  if (res?.status) {
    const currentVault = await pearpassVaultClient.activeVaultGet(`vault`)

    if (currentVault && vaultId === currentVault.id) {
      return currentVault
    }
  }

  const hasRawCredentials =
    params?.ciphertext && params?.nonce && params?.hashedPassword

  // A closed protected vault opens only from its password. Raw credentials
  // would let a KEK copied out of the catalog open it without one.
  if (hasRawCredentials && isProtected) {
    throw new Error('Vault password is required')
  }

  if (res?.status) {
    await pearpassVaultClient.activeVaultClose()
  }

  let encryptionKey

  if (hasRawCredentials) {
    encryptionKey = await pearpassVaultClient.decryptVaultKey({
      ciphertext: params.ciphertext,
      nonce: params.nonce,
      hashedPassword: params.hashedPassword
    })

    await pearpassVaultClient.activeVaultInit({ id: vaultId, encryptionKey })

    const newVault = await pearpassVaultClient.activeVaultGet(`vault`)

    return newVault
  }

  if (!params?.password || params.password.length === 0) {
    const masterEncryption = await getMasterPasswordEncryption()

    encryptionKey = await pearpassVaultClient.decryptVaultKey({
      hashedPassword: masterEncryption.hashedPassword,
      ciphertext: masterEncryption.ciphertext,
      nonce: masterEncryption.nonce
    })
  } else {
    const hashedPassword = await pearpassVaultClient.getDecryptionKey({
      password: params.password,
      salt
    })

    encryptionKey = await pearpassVaultClient.decryptVaultKey({
      hashedPassword,
      ciphertext,
      nonce
    })
  }

  if (!encryptionKey) {
    throw new Error('Error decrypting vault key')
  }

  await pearpassVaultClient.activeVaultInit({ id: vaultId, encryptionKey })

  const newVault = await pearpassVaultClient.activeVaultGet(`vault`)

  return newVault
}
