import { kickDeviceActionHandler } from './kickDevice'
import { pearpassVaultClient } from '../../instances'
import { clearAllRevoked } from '../../utils/revocationGuard'

describe('kickDeviceActionHandler', () => {
  beforeEach(() => {
    clearAllRevoked()
    pearpassVaultClient.listenerCount.mockReset()
    pearpassVaultClient.emit.mockReset()
  })

  it('throws when payload.vaultId is missing', async () => {
    await expect(
      kickDeviceActionHandler.execute({
        payload: { targetDeviceId: 'B' },
        actor: 'A'
      })
    ).rejects.toThrow('vaultId and payload.targetDeviceId are required')
  })

  it('throws when payload.targetDeviceId is missing', async () => {
    await expect(
      kickDeviceActionHandler.execute({
        payload: { vaultId: 'v1' },
        actor: 'A'
      })
    ).rejects.toThrow('vaultId and payload.targetDeviceId are required')
  })

  it('defers when no vault-access-revoked listener is attached', async () => {
    pearpassVaultClient.listenerCount.mockReturnValue(0)

    const result = await kickDeviceActionHandler.execute({
      payload: { vaultId: 'v1', targetDeviceId: 'SELF' },
      actor: 'A'
    })

    expect(result).toEqual({ status: 'deferred', reason: 'no-listener' })
    expect(pearpassVaultClient.emit).not.toHaveBeenCalled()
  })

  it('emits vault-access-revoked with the kicked vaultId and actor', async () => {
    pearpassVaultClient.listenerCount.mockReturnValue(1)

    await kickDeviceActionHandler.execute({
      payload: { vaultId: 'v1', targetDeviceId: 'SELF', targetWriterKey: 'w' },
      actor: 'A'
    })

    expect(pearpassVaultClient.emit).toHaveBeenCalledWith(
      'vault-access-revoked',
      { vaultId: 'v1', actor: 'A' }
    )
  })

  it('emits once per vault and marks only on an actual emit', async () => {
    const kick = {
      payload: { vaultId: 'v-once', targetDeviceId: 'SELF' },
      actor: 'A'
    }
    pearpassVaultClient.listenerCount.mockReturnValue(0)
    await kickDeviceActionHandler.execute(kick)

    pearpassVaultClient.listenerCount.mockReturnValue(1)
    await kickDeviceActionHandler.execute(kick)
    await kickDeviceActionHandler.execute(kick)

    expect(pearpassVaultClient.emit).toHaveBeenCalledTimes(1)
  })
})
