jest.mock('./broadcastAction', () => ({
  broadcastAction: jest.fn()
}))

jest.mock('./listDevices', () => ({
  listDevices: jest.fn()
}))

jest.mock('../actions', () => ({
  ACTION_TYPES: { KICK_DEVICE: 'kick-device' }
}))

import { broadcastAction } from './broadcastAction'
import { EPOCH_FAILURE_KIND, kickDevice } from './kickDevice'
import { listDevices } from './listDevices'
import { pearpassVaultClient } from '../instances'

describe('kickDevice', () => {
  beforeEach(() => {
    broadcastAction.mockReset()
    broadcastAction.mockResolvedValue({ results: [], failures: [] })
    listDevices.mockReset()
    pearpassVaultClient.activeVaultGetWriterKey.mockReset()
    pearpassVaultClient.activeVaultGetWriterKey.mockResolvedValue('w-self')
    pearpassVaultClient.activeVaultRemoveWriter.mockReset()
    pearpassVaultClient.activeVaultRemoveWriter.mockResolvedValue(undefined)
    pearpassVaultClient.activeVaultRemove.mockReset()
    pearpassVaultClient.activeVaultRemove.mockResolvedValue(undefined)
    pearpassVaultClient.activeVaultEnsureEpoch.mockReset()
    pearpassVaultClient.activeVaultEnsureEpoch.mockResolvedValue({
      rotated: true,
      id: 'e2',
      seq: 2,
      members: ['SELF'],
      uncovered: []
    })
  })

  it('rejects when vaultId is missing', async () => {
    await expect(kickDevice({ targetDeviceId: 'B' })).rejects.toThrow(
      'vaultId is required'
    )
  })

  it('rejects when targetDeviceId is missing', async () => {
    await expect(kickDevice({ vaultId: 'v1' })).rejects.toThrow(
      'targetDeviceId is required'
    )
  })

  it('rejects when own writer key cannot be resolved', async () => {
    pearpassVaultClient.activeVaultGetWriterKey.mockResolvedValue(null)
    await expect(
      kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })
    ).rejects.toThrow('cannot resolve own writer key')
  })

  it('rejects when target shares our writer key (self)', async () => {
    listDevices.mockResolvedValue([{ id: 'SELF', writerKey: 'w-self' }])
    await expect(
      kickDevice({ vaultId: 'v1', targetDeviceId: 'SELF' })
    ).rejects.toThrow('cannot kick self')
    expect(pearpassVaultClient.activeVaultRemoveWriter).not.toHaveBeenCalled()
  })

  it('rejects when target device is not in the vault', async () => {
    listDevices.mockResolvedValue([{ id: 'SELF', writerKey: 'w-self' }])
    await expect(
      kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })
    ).rejects.toThrow('target device not found')
    expect(pearpassVaultClient.activeVaultRemoveWriter).not.toHaveBeenCalled()
  })

  it('broadcasts before removing writer/entry so the envelope still finds the target', async () => {
    listDevices.mockResolvedValue([
      { id: 'SELF', writerKey: 'w-self' },
      { id: 'B', writerKey: 'w-b' }
    ])

    const callOrder = []
    broadcastAction.mockImplementation(async () => {
      callOrder.push('broadcast')
      return { results: [], failures: [] }
    })
    pearpassVaultClient.activeVaultRemoveWriter.mockImplementation(async () => {
      callOrder.push('removeWriter')
    })
    pearpassVaultClient.activeVaultRemove.mockImplementation(async () => {
      callOrder.push('removeEntry')
    })

    await kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })

    expect(pearpassVaultClient.activeVaultRemoveWriter).toHaveBeenCalledWith(
      'w-b'
    )
    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledWith(
      'device/B'
    )
    expect(callOrder).toEqual(['broadcast', 'removeWriter', 'removeEntry'])
    expect(broadcastAction).toHaveBeenCalledWith({
      type: 'kick-device',
      payload: { vaultId: 'v1', targetDeviceId: 'B', targetWriterKey: 'w-b' },
      targets: ['B']
    })
  })

  it('skips removeWriter when target has no writerKey but still removes entry and broadcasts', async () => {
    listDevices.mockResolvedValue([
      { id: 'SELF', writerKey: 'w-self' },
      { id: 'B' }
    ])

    await kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })

    expect(pearpassVaultClient.activeVaultRemoveWriter).not.toHaveBeenCalled()
    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledWith(
      'device/B'
    )
    expect(broadcastAction).toHaveBeenCalledWith({
      type: 'kick-device',
      payload: { vaultId: 'v1', targetDeviceId: 'B', targetWriterKey: null },
      targets: ['B']
    })
  })

  it('forwards broadcastAction result to the caller', async () => {
    listDevices.mockResolvedValue([
      { id: 'SELF', writerKey: 'w-self' },
      { id: 'B', writerKey: 'w-b' }
    ])
    broadcastAction.mockResolvedValue({
      results: [],
      failures: [{ targetDeviceId: 'B', error: new Error('boom') }]
    })

    const result = await kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })

    expect(result.failures).toHaveLength(1)
  })

  it('treats a broadcastAction throw as a partial-delivery failure but still completes the autobase ops', async () => {
    listDevices.mockResolvedValue([
      { id: 'SELF', writerKey: 'w-self' },
      { id: 'B', writerKey: 'w-b' }
    ])
    const boom = new Error('cannot resolve own device id')
    broadcastAction.mockRejectedValue(boom)

    const result = await kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })

    expect(pearpassVaultClient.activeVaultRemoveWriter).toHaveBeenCalledWith(
      'w-b'
    )
    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledWith(
      'device/B'
    )
    expect(result.results).toEqual([])
    expect(result.failures).toEqual([{ targetDeviceId: 'B', error: boom }])
  })

  it('removes every device entry mapped to the same writerKey so duplicate rows for the same peer are not stranded', async () => {
    listDevices.mockResolvedValue([
      { id: 'SELF', writerKey: 'w-self' },
      { id: 'B1', writerKey: 'w-b' },
      { id: 'B2', writerKey: 'w-b' }
    ])

    await kickDevice({ vaultId: 'v1', targetDeviceId: 'B1' })

    expect(pearpassVaultClient.activeVaultRemoveWriter).toHaveBeenCalledTimes(1)
    expect(pearpassVaultClient.activeVaultRemoveWriter).toHaveBeenCalledWith(
      'w-b'
    )
    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledWith(
      'device/B1'
    )
    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledWith(
      'device/B2'
    )
    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledTimes(2)
  })

  it('treats an autobase removal throw as a partial-delivery failure without throwing', async () => {
    listDevices.mockResolvedValue([
      { id: 'SELF', writerKey: 'w-self' },
      { id: 'B', writerKey: 'w-b' }
    ])
    const boom = new Error('autobase removal failed')
    pearpassVaultClient.activeVaultRemove.mockRejectedValue(boom)

    const result = await kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })

    expect(broadcastAction).toHaveBeenCalled()
    expect(pearpassVaultClient.activeVaultRemoveWriter).toHaveBeenCalledWith(
      'w-b'
    )
    expect(result.failures).toEqual([{ targetDeviceId: 'B', error: boom }])
  })

  it('rotates the epoch after the roster rows are gone and returns the result', async () => {
    listDevices.mockResolvedValue([
      { id: 'SELF', writerKey: 'w-self' },
      { id: 'B', writerKey: 'w-b' }
    ])
    const callOrder = []
    pearpassVaultClient.activeVaultRemove.mockImplementation(async () => {
      callOrder.push('removeEntry')
    })
    pearpassVaultClient.activeVaultEnsureEpoch.mockImplementation(async () => {
      callOrder.push('ensureEpoch')
      return {
        rotated: true,
        id: 'e2',
        seq: 2,
        members: ['SELF'],
        uncovered: []
      }
    })

    const result = await kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })

    expect(callOrder).toEqual(['removeEntry', 'ensureEpoch'])
    expect(pearpassVaultClient.activeVaultEnsureEpoch).toHaveBeenCalledWith({
      start: true
    })
    expect(result).toEqual({
      results: [],
      failures: [],
      epoch: {
        rotated: true,
        id: 'e2',
        seq: 2,
        members: ['SELF'],
        uncovered: []
      }
    })
  })

  it('reports a rotation that did not happen as a failure', async () => {
    listDevices.mockResolvedValue([
      { id: 'SELF', writerKey: 'w-self' },
      { id: 'B', writerKey: 'w-b' }
    ])
    const epoch = {
      rotated: false,
      reason: 'self-not-in-roster',
      uncovered: []
    }
    pearpassVaultClient.activeVaultEnsureEpoch.mockResolvedValue(epoch)

    const result = await kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })

    expect(result.epoch).toEqual(epoch)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].targetDeviceId).toBe('B')
    expect(result.failures[0].kind).toBe(EPOCH_FAILURE_KIND)
    expect(result.failures[0].error.message).toBe(
      'epoch rotation failed: self-not-in-roster'
    )
  })

  it('does not report a rotation left to another member as a failure', async () => {
    listDevices.mockResolvedValue([
      { id: 'SELF', writerKey: 'w-self' },
      { id: 'B', writerKey: 'w-b' }
    ])
    pearpassVaultClient.activeVaultEnsureEpoch.mockResolvedValue({
      rotated: false,
      reason: 'pending',
      uncovered: []
    })

    const result = await kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })

    expect(result.failures).toEqual([])
  })

  it('does not report an already current epoch as a failure', async () => {
    listDevices.mockResolvedValue([
      { id: 'SELF', writerKey: 'w-self' },
      { id: 'B', writerKey: 'w-b' }
    ])
    pearpassVaultClient.activeVaultEnsureEpoch.mockResolvedValue({
      rotated: false,
      reason: 'current',
      uncovered: []
    })

    const result = await kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })

    expect(result.failures).toEqual([])
  })

  it('keeps earlier results and records a failure when rotation throws', async () => {
    listDevices.mockResolvedValue([
      { id: 'SELF', writerKey: 'w-self' },
      { id: 'B', writerKey: 'w-b' }
    ])
    const delivered = { targetDeviceId: 'B', channel: 'outbox' }
    broadcastAction.mockResolvedValue({ results: [delivered], failures: [] })
    pearpassVaultClient.activeVaultEnsureEpoch.mockRejectedValue(
      new Error('Not writable')
    )

    const result = await kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })

    expect(result.results).toEqual([delivered])
    expect(result.epoch).toBeNull()
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].kind).toBe('epoch')
    expect(result.failures[0].error.message).toBe(
      'epoch rotation failed: Not writable'
    )
  })

  it('skips rotation and returns a null epoch when the roster removal fails', async () => {
    listDevices.mockResolvedValue([
      { id: 'SELF', writerKey: 'w-self' },
      { id: 'B', writerKey: 'w-b' }
    ])
    pearpassVaultClient.activeVaultRemove.mockRejectedValue(new Error('boom'))

    const result = await kickDevice({ vaultId: 'v1', targetDeviceId: 'B' })

    expect(pearpassVaultClient.activeVaultEnsureEpoch).not.toHaveBeenCalled()
    expect(result.epoch).toBeNull()
  })
})
