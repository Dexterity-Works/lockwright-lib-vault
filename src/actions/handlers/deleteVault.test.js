import { deleteVaultActionHandler } from './deleteVault'
import { pearpassVaultClient } from '../../instances'
import { clearAllRevoked, isRevoked } from '../../utils/revocationGuard'

describe('deleteVaultActionHandler', () => {
  beforeEach(() => {
    clearAllRevoked()
    pearpassVaultClient.listenerCount.mockReset()
    pearpassVaultClient.emit.mockReset()
  })

  it('throws when payload.vaultId is missing', async () => {
    await expect(
      deleteVaultActionHandler.execute({ payload: {}, actor: 'A' })
    ).rejects.toThrow('payload.vaultId is required')
  })

  it('defers without marking when no vault-access-revoked listener is attached', async () => {
    pearpassVaultClient.listenerCount.mockReturnValue(0)

    const result = await deleteVaultActionHandler.execute({
      payload: { vaultId: 'v1' },
      actor: 'A'
    })

    expect(result).toEqual({ status: 'deferred', reason: 'no-listener' })
    expect(pearpassVaultClient.emit).not.toHaveBeenCalled()
    expect(isRevoked('v1')).toBe(false)
  })

  it('marks the vault revoked and emits vault-access-revoked once per vault', async () => {
    pearpassVaultClient.listenerCount.mockReturnValue(1)
    const action = { payload: { vaultId: 'v1' }, actor: 'A' }

    await deleteVaultActionHandler.execute(action)
    await deleteVaultActionHandler.execute(action)

    expect(isRevoked('v1')).toBe(true)
    expect(pearpassVaultClient.emit).toHaveBeenCalledTimes(1)
    expect(pearpassVaultClient.emit).toHaveBeenCalledWith(
      'vault-access-revoked',
      { vaultId: 'v1', actor: 'A' }
    )
  })
})
