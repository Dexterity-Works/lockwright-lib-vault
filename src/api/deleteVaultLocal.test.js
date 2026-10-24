import { ACTION_TYPES } from '../actions'
import { pearpassVaultClient } from '../instances'
import { broadcastAction } from './broadcastAction'
import { deleteVaultLocal, VaultNotActiveError } from './deleteVaultLocal'
import { listVaults } from './listVaults'
import { deleteVaultActionHandler } from '../actions/handlers/deleteVault'
import { kickDeviceActionHandler } from '../actions/handlers/kickDevice'
import { getMyDeviceId } from '../utils/getMyDeviceId'
import { clearAllRevoked } from '../utils/revocationGuard'

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
    clearAllRevoked()
    getMyDeviceId.mockResolvedValue('SELF')
    pearpassVaultClient.activeVaultGetStatus.mockResolvedValue({ status: true })
    pearpassVaultClient.activeVaultGet.mockResolvedValue({ id: 'v1' })
  })

  it('refuses a vault that is not active before it reads the device id', async () => {
    pearpassVaultClient.activeVaultGet.mockResolvedValue({ id: 'v2' })

    const error = await deleteVaultLocal('v1').catch((e) => e)

    expect(error).toBeInstanceOf(VaultNotActiveError)
    expect(error.name).toBe('VaultNotActiveError')
    expect(error.vaultId).toBe('v1')
    expect(getMyDeviceId).not.toHaveBeenCalled()
    expect(broadcastAction).not.toHaveBeenCalled()
    expect(pearpassVaultClient.removeVault).not.toHaveBeenCalled()
  })

  it('refuses when no vault is active', async () => {
    pearpassVaultClient.activeVaultGetStatus.mockResolvedValue({
      status: false
    })

    await expect(deleteVaultLocal('v1')).rejects.toBeInstanceOf(
      VaultNotActiveError
    )
    expect(broadcastAction).not.toHaveBeenCalled()
    expect(pearpassVaultClient.removeVault).not.toHaveBeenCalled()
  })

  it('wipes a kicked vault that is not active, without a leave', async () => {
    pearpassVaultClient.activeVaultGet.mockResolvedValue({ id: 'v2' })
    pearpassVaultClient.listenerCount.mockReturnValue(1)
    await kickDeviceActionHandler.execute({
      actor: 'A',
      payload: { vaultId: 'v1', targetDeviceId: 'SELF' }
    })

    await deleteVaultLocal('v1')

    expect(getMyDeviceId).not.toHaveBeenCalled()
    expect(broadcastAction).not.toHaveBeenCalled()
    expect(pearpassVaultClient.removeVault).toHaveBeenCalledWith('v1')
  })

  it('wipes a vault erased from all devices that is not active, without a leave', async () => {
    pearpassVaultClient.activeVaultGet.mockResolvedValue({ id: 'v2' })
    pearpassVaultClient.listenerCount.mockReturnValue(1)
    await deleteVaultActionHandler.execute({
      actor: 'A',
      payload: { vaultId: 'v1' }
    })

    await deleteVaultLocal('v1')

    expect(broadcastAction).not.toHaveBeenCalled()
    expect(pearpassVaultClient.removeVault).toHaveBeenCalledWith('v1')
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
