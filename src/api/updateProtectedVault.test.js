import { updateProtectedVault } from './updateProtectedVault'
import { pearpassVaultClient } from '../instances'
import { getMasterPasswordEncryption } from './getMasterPasswordEncryption'
import { initActiveVaultWithCredentials } from './initActiveVaultWithCredentials'
import { listVaults } from './listVaults'

// Not a declared dependency of this package; hosts provide it.
jest.mock(
  'lockwright-utils-password-check',
  () => ({ constantTimeHashCompare: (a, b) => a === b }),
  { virtual: true }
)

jest.mock('../instances', () => ({
  pearpassVaultClient: {
    activeVaultGet: jest.fn(),
    activeVaultAdd: jest.fn(),
    vaultsAdd: jest.fn(),
    getDecryptionKey: jest.fn()
  }
}))

jest.mock('./listVaults', () => ({ listVaults: jest.fn() }))
jest.mock('./getMasterPasswordEncryption', () => ({
  getMasterPasswordEncryption: jest.fn()
}))
jest.mock('./initActiveVaultWithCredentials', () => ({
  initActiveVaultWithCredentials: jest.fn()
}))

describe('updateProtectedVault rename', () => {
  const encryption = {
    ciphertext: 'ct',
    nonce: 'n',
    salt: 's',
    hashedPassword: 'kek'
  }
  const renamed = { id: 'v1', name: 'Renamed', encryption }

  beforeEach(() => {
    jest.clearAllMocks()
    pearpassVaultClient.getDecryptionKey.mockResolvedValue('kek')
    getMasterPasswordEncryption.mockResolvedValue({})
    initActiveVaultWithCredentials.mockResolvedValue(true)
    listVaults.mockResolvedValue([
      { id: 'v1', encryption: { ciphertext: 'ct', nonce: 'n', salt: 's' } }
    ])
  })

  it.each([
    ['active', { id: 'v1', encryption }],
    ['inactive', { id: 'other', encryption: {} }]
  ])(
    'keeps the vault KEK out of the master catalog (%s vault)',
    async (_label, activeVault) => {
      pearpassVaultClient.activeVaultGet.mockResolvedValue(activeVault)

      await updateProtectedVault({ vault: renamed, currentPassword: 'pw' })

      expect(pearpassVaultClient.activeVaultAdd).toHaveBeenCalledWith(
        'vault',
        renamed
      )
      expect(pearpassVaultClient.vaultsAdd).toHaveBeenCalledWith('vault/v1', {
        id: 'v1',
        name: 'Renamed',
        encryption: { ciphertext: 'ct', nonce: 'n', salt: 's' }
      })
    }
  )
})
