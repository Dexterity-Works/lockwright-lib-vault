import { ACTION_TYPES } from '../actions'
import { pearpassVaultClient } from '../instances'
import { broadcastAction } from './broadcastAction'
import { deleteVaultLocal } from './deleteVaultLocal'
import { listVaults } from './listVaults'
import { kickDeviceActionHandler } from '../actions/handlers/kickDevice'
import { getMyDeviceId } from '../utils/getMyDeviceId'

jest.mock('./listVaults', () => ({
  listVaults: jest.fn()
}))

jest.mock('./broadcastAction', () => ({
  broadcastAction: jest.fn().mockResolvedValue({ results: [], failures: [] })
}))

jest.mock('../utils/getMyDeviceId', () => ({
  getMyDeviceId: jest.fn()
}))

describe('deleteVaultLocal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getMyDeviceId.mockResolvedValue('SELF')
  })

  it('throws when vaultId is missing', async () => {
    await expect(deleteVaultLocal()).rejects.toThrow('vaultId is required')
    expect(pearpassVaultClient.removeVault).not.toHaveBeenCalled()
    expect(broadcastAction).not.toHaveBeenCalled()
  })

  it('broadcasts leave-vault before removing locally', async () => {
    const remaining = [{ id: 'v2' }]
    listVaults.mockResolvedValueOnce(remaining)

    const result = await deleteVaultLocal('v1')

    expect(broadcastAction).toHaveBeenCalledWith({
      type: ACTION_TYPES.LEAVE_VAULT,
      payload: { vaultId: 'v1' }
    })
    expect(pearpassVaultClient.removeVault).toHaveBeenCalledWith('v1')
    expect(listVaults).toHaveBeenCalledTimes(1)
    expect(result).toBe(remaining)

    expect(broadcastAction.mock.invocationCallOrder[0]).toBeLessThan(
      pearpassVaultClient.removeVault.mock.invocationCallOrder[0]
    )
  })

  it('still removes locally when broadcastAction fails', async () => {
    broadcastAction.mockRejectedValueOnce(new Error('broadcast boom'))
    const remaining = []
    listVaults.mockResolvedValueOnce(remaining)

    const result = await deleteVaultLocal('v1')

    expect(pearpassVaultClient.removeVault).toHaveBeenCalledWith('v1')
    expect(result).toBe(remaining)
  })

  it('does not call listVaults if removeVault fails', async () => {
    pearpassVaultClient.removeVault.mockRejectedValueOnce(new Error('boom'))

    await expect(deleteVaultLocal('v1')).rejects.toThrow('boom')
    expect(listVaults).not.toHaveBeenCalled()
  })

  it('skips broadcastAction when our device entry is already gone (post-kick)', async () => {
    getMyDeviceId.mockResolvedValueOnce(null)
    const remaining = []
    listVaults.mockResolvedValueOnce(remaining)

    const result = await deleteVaultLocal('v1')

    expect(broadcastAction).not.toHaveBeenCalled()
    expect(pearpassVaultClient.removeVault).toHaveBeenCalledWith('v1')
    expect(result).toBe(remaining)
  })

  it('skips broadcastAction when getMyDeviceId throws', async () => {
    getMyDeviceId.mockRejectedValueOnce(new Error('boom'))
    const remaining = []
    listVaults.mockResolvedValueOnce(remaining)

    await deleteVaultLocal('v1')

    expect(broadcastAction).not.toHaveBeenCalled()
    expect(pearpassVaultClient.removeVault).toHaveBeenCalledWith('v1')
  })

  it('lets a re-paired vault be revoked again after the wipe', async () => {
    pearpassVaultClient.listenerCount.mockReturnValue(1)
    const kick = {
      actor: 'A',
      payload: { vaultId: 'v-repair', targetDeviceId: 'SELF' }
    }

    await kickDeviceActionHandler.execute(kick)
    await deleteVaultLocal('v-repair')
    await kickDeviceActionHandler.execute(kick)

    expect(
      pearpassVaultClient.emit.mock.calls.filter(
        ([event]) => event === 'vault-access-revoked'
      )
    ).toHaveLength(2)
  })
})
