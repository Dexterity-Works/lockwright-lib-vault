import {
  setPearpassVaultClient,
  pearpassVaultClient,
  getCurrentDeviceName,
  setStoragePath
} from './index'
import { kickDeviceActionHandler } from '../actions/handlers/kickDevice'

const mockRunActionScan = jest.fn().mockResolvedValue(undefined)
jest.mock('../api/actionRunner.js', () => ({
  runActionScan: (...args) => mockRunActionScan(...args)
}))

describe('instance management functions', () => {
  beforeEach(() => {
    mockRunActionScan.mockClear()
  })

  test('setPearpassVaultClient sets the client and device name', () => {
    const mockInstance = {
      setStoragePath: jest.fn()
    }

    setPearpassVaultClient(mockInstance, { currentDeviceName: 'ios 18.0' })

    expect(pearpassVaultClient).toBe(mockInstance)
    expect(getCurrentDeviceName()).toBe('ios 18.0')
  })

  test('setPearpassVaultClient defaults currentDeviceName to null when not provided', () => {
    const mockInstance = { setStoragePath: jest.fn() }

    setPearpassVaultClient(mockInstance)

    expect(getCurrentDeviceName()).toBeNull()
  })

  test('setStoragePath calls setStoragePath on the client instance', async () => {
    const mockInstance = {
      setStoragePath: jest.fn().mockResolvedValue(undefined)
    }
    setPearpassVaultClient(mockInstance)
    const testPath = '/test/path'

    await setStoragePath(testPath)

    expect(mockInstance.setStoragePath).toHaveBeenCalledWith(testPath)
    expect(mockInstance.setStoragePath).toHaveBeenCalledTimes(1)
  })

  test('setStoragePath throws if client is not initialized', async () => {
    setPearpassVaultClient(undefined)

    await expect(setStoragePath('/any/path')).rejects.toThrow()
  })

  test('subscribes to master-update and kicks runActionScan when fired', async () => {
    const listeners = new Map()
    const mockInstance = {
      setStoragePath: jest.fn(),
      on: jest.fn((event, handler) => {
        listeners.set(event, handler)
      }),
      off: jest.fn()
    }

    setPearpassVaultClient(mockInstance)

    expect(mockInstance.on).toHaveBeenCalledWith(
      'master-update',
      expect.any(Function)
    )

    await listeners.get('master-update')?.()

    expect(mockRunActionScan).toHaveBeenCalledTimes(1)
  })

  test('detaches the master-update listener when the client is replaced', () => {
    const firstInstance = {
      setStoragePath: jest.fn(),
      on: jest.fn(),
      off: jest.fn()
    }
    const secondInstance = {
      setStoragePath: jest.fn(),
      on: jest.fn(),
      off: jest.fn()
    }

    setPearpassVaultClient(firstInstance)
    const firstHandler = firstInstance.on.mock.calls.find(
      ([event]) => event === 'master-update'
    )?.[1]

    setPearpassVaultClient(secondInstance)

    expect(firstInstance.off).toHaveBeenCalledWith(
      'master-update',
      firstHandler
    )
    expect(secondInstance.on).toHaveBeenCalledWith(
      'master-update',
      expect.any(Function)
    )
  })

  describe('epoch-status', () => {
    const setup = () => {
      const listeners = new Map()
      const mockInstance = {
        on: jest.fn((event, handler) => listeners.set(event, handler)),
        off: jest.fn(),
        emit: jest.fn(),
        listenerCount: jest.fn().mockReturnValue(1),
        activeVaultGet: jest.fn().mockResolvedValue({ id: 'other' }),
        activeVaultGetEpochStatus: jest.fn()
      }
      setPearpassVaultClient(mockInstance)
      return {
        mockInstance,
        fire: (s) => listeners.get('epoch-status')?.(s),
        subscribe: (event) => listeners.get('newListener')?.(event)
      }
    }

    test('emits vault-access-revoked once per vault when revoked', async () => {
      const { mockInstance, fire } = setup()

      await fire({ vaultId: 'v1', revoked: true, canRead: false })
      await fire({ vaultId: 'v1', revoked: true, canRead: false })

      expect(mockInstance.emit).toHaveBeenCalledTimes(1)
      expect(mockInstance.emit).toHaveBeenCalledWith('vault-access-revoked', {
        vaultId: 'v1',
        actor: null,
        reason: 'epoch'
      })
    })

    test('ignores a status without a vaultId instead of guessing the active vault', async () => {
      const { mockInstance, fire } = setup()

      await fire({ revoked: true, canRead: false })

      expect(mockInstance.activeVaultGet).not.toHaveBeenCalled()
      expect(mockInstance.emit).not.toHaveBeenCalled()
    })

    test('emits again after a not-revoked status for the same vault', async () => {
      const { mockInstance, fire } = setup()

      await fire({ vaultId: 'v1', revoked: true, canRead: false })
      await fire({ vaultId: 'v1', revoked: false, canRead: true })
      await fire({ vaultId: 'v1', revoked: true, canRead: false })

      expect(mockInstance.emit).toHaveBeenCalledTimes(2)
    })

    test('emits once per vault across a kick envelope and an epoch status', async () => {
      const { mockInstance, fire } = setup()

      await kickDeviceActionHandler.execute({
        actor: 'A',
        payload: { vaultId: 'v1', targetDeviceId: 'SELF' }
      })
      await fire({ vaultId: 'v1', revoked: true, canRead: false })

      expect(mockInstance.emit).toHaveBeenCalledTimes(1)
      expect(mockInstance.emit).toHaveBeenCalledWith('vault-access-revoked', {
        vaultId: 'v1',
        actor: 'A'
      })
    })

    test('emits nothing when not revoked', async () => {
      const { mockInstance, fire } = setup()

      await fire({ vaultId: 'v1', revoked: false, canRead: true })

      expect(mockInstance.emit).not.toHaveBeenCalled()
    })

    test('holds a revocation until a vault-access-revoked listener exists', async () => {
      const { mockInstance, fire } = setup()
      mockInstance.listenerCount.mockReturnValue(0)

      await fire({ vaultId: 'v1', revoked: true, canRead: false })
      expect(mockInstance.emit).not.toHaveBeenCalled()

      mockInstance.listenerCount.mockReturnValue(1)
      await fire({ vaultId: 'v1', revoked: true, canRead: false })

      expect(mockInstance.emit).toHaveBeenCalledTimes(1)
      expect(mockInstance.emit).toHaveBeenCalledWith('vault-access-revoked', {
        vaultId: 'v1',
        actor: null,
        reason: 'epoch'
      })
    })

    test('re-checks the epoch status when a revoked listener subscribes', async () => {
      const { mockInstance, subscribe } = setup()
      mockInstance.activeVaultGetEpochStatus.mockResolvedValue({
        vaultId: 'v1',
        revoked: true,
        canRead: false
      })

      await subscribe('vault-access-revoked')
      await subscribe('vault-access-revoked')

      expect(mockInstance.activeVaultGetEpochStatus).toHaveBeenCalled()
      expect(mockInstance.emit).toHaveBeenCalledTimes(1)
      expect(mockInstance.emit).toHaveBeenCalledWith('vault-access-revoked', {
        vaultId: 'v1',
        actor: null,
        reason: 'epoch'
      })
    })

    test('emits nothing on subscribe when the status is not revoked', async () => {
      const { mockInstance, subscribe } = setup()
      mockInstance.activeVaultGetEpochStatus.mockResolvedValue({
        vaultId: 'v1',
        revoked: false,
        canRead: true
      })

      await subscribe('vault-access-revoked')

      expect(mockInstance.activeVaultGetEpochStatus).toHaveBeenCalled()
      expect(mockInstance.emit).not.toHaveBeenCalled()
    })
  })
})
