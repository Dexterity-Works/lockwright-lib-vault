import { pearpassVaultClient } from '../instances'
import { getVaultKeyState } from './vaultKeyState'

const status = (overrides = {}) => ({
  vaultId: 'v1',
  epoch: 'e2',
  seq: 2,
  legacy: false,
  canRead: true,
  revoked: false,
  members: ['A', 'B', 'K'],
  uncovered: [],
  ...overrides
})

describe('getVaultKeyState', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(status())
    pearpassVaultClient.activeVaultList.mockResolvedValue([
      { id: 'A', name: 'Laptop' },
      { id: 'B', name: 'Phone' }
    ])
    pearpassVaultClient.activeVaultGet.mockResolvedValue({
      id: 'e2',
      createdAt: 1761300000000
    })
    pearpassVaultClient.vaultsGet.mockResolvedValue({
      id: 'K',
      name: 'Old Phone'
    })
  })

  it('lists the removed devices the latest key still reaches, by name', async () => {
    const state = await getVaultKeyState()

    expect(state).toEqual({
      vaultId: 'v1',
      epoch: 'e2',
      legacy: false,
      canRead: true,
      members: ['A', 'B', 'K'],
      rotatedAt: 1761300000000,
      removed: [{ id: 'K', name: 'Old Phone' }]
    })
    expect(pearpassVaultClient.activeVaultList).toHaveBeenCalledWith('device/')
    expect(pearpassVaultClient.activeVaultGet).toHaveBeenCalledWith('epoch/e2')
    expect(pearpassVaultClient.vaultsGet).toHaveBeenCalledWith('peer/K')
  })

  it('lists nobody once the key leaves every removed device out', async () => {
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(
      status({ epoch: 'e3', members: ['A', 'B'] })
    )

    const state = await getVaultKeyState()

    expect(state.removed).toEqual([])
    expect(pearpassVaultClient.vaultsGet).not.toHaveBeenCalled()
  })

  it('names a removed device it has no peer record for as null', async () => {
    pearpassVaultClient.vaultsGet.mockRejectedValue(new Error('boom'))

    const state = await getVaultKeyState()

    expect(state.removed).toEqual([{ id: 'K', name: null }])
  })

  it('has no rotation time for a vault without an epoch', async () => {
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(
      status({ epoch: null, seq: 0, legacy: true, members: [] })
    )

    const state = await getVaultKeyState()

    expect(state.rotatedAt).toBeNull()
    expect(state.removed).toEqual([])
    expect(pearpassVaultClient.activeVaultGet).not.toHaveBeenCalled()
  })

  it('has no rotation time when the epoch record has none', async () => {
    pearpassVaultClient.activeVaultGet.mockResolvedValue(null)

    expect((await getVaultKeyState()).rotatedAt).toBeNull()
  })

  it('returns null without a status for a vault', async () => {
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(null)

    expect(await getVaultKeyState()).toBeNull()
  })
})
