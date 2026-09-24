import { pearpassVaultClient } from '../instances'
import { toCatalogVault } from '../utils/toCatalogVault'

/**
 * @returns {Promise<Array<any>>}
 */
export const listVaults = async () => {
  const vaults = await pearpassVaultClient.vaultsList('vault/')

  // Older renames and pairs wrote encryption.hashedPassword here. Drop it on
  // read; the next catalog write of that vault drops it from the store.
  return vaults?.map(toCatalogVault)
}
