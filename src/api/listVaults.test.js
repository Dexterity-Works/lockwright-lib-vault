import { listVaults } from './listVaults'
import { pearpassVaultClient } from '../instances'

describe('listVaults', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should call vaultsList with correct path', async () => {
    pearpassVaultClient.vaultsList.mockResolvedValueOnce([])
    await listVaults()
    expect(pearpassVaultClient.vaultsList).toHaveBeenCalledWith('vault/')
  })

  it('should return vaults from vaultsList', async () => {
    const mockVaults = [{ id: '1' }, { id: '2' }]
    pearpassVaultClient.vaultsList.mockResolvedValueOnce(mockVaults)

    const result = await listVaults()

    expect(result).toEqual(mockVaults)
    expect(pearpassVaultClient.vaultsList).toHaveBeenCalledTimes(1)
  })

  it('never returns a vault KEK left in the catalog by an older rename', async () => {
    pearpassVaultClient.vaultsList.mockResolvedValueOnce([
      {
        id: '1',
        encryption: {
          ciphertext: 'ct',
          nonce: 'n',
          salt: 's',
          hashedPassword: 'kek'
        }
      }
    ])

    const [vault] = await listVaults()

    expect(vault.encryption).not.toHaveProperty('hashedPassword')
    expect(vault.encryption).toEqual({
      ciphertext: 'ct',
      nonce: 'n',
      salt: 's'
    })
  })

  it('should propagate errors', async () => {
    const mockError = new Error('API error')
    pearpassVaultClient.vaultsList.mockRejectedValueOnce(mockError)

    await expect(listVaults()).rejects.toThrow('API error')
  })
})
