import { broadcastAction } from './broadcastAction'
import { pearpassVaultClient } from '../instances'

jest.mock(
  'lockwright-utils-generate-unique-id',
  () => ({ generateUniqueId: jest.fn(() => 'fixed-id') }),
  { virtual: true }
)

jest.mock('../actions', () => ({
  ACTION_TYPES: { LOGOUT: 'logout', DELETE_VAULT: 'delete-vault' }
}))

jest.mock('./actionRunner', () => ({
  runActionScan: jest.fn().mockResolvedValue(undefined)
}))

describe('broadcastAction', () => {
  beforeEach(() => {
    pearpassVaultClient.activeVaultGetWriterKey.mockReset()
    pearpassVaultClient.activeVaultList.mockReset()
    pearpassVaultClient.vaultsAdd.mockReset()

    pearpassVaultClient.activeVaultGetWriterKey.mockResolvedValue('w-aaa')
  })

  it('throws when type is missing', async () => {
    pearpassVaultClient.activeVaultList.mockResolvedValue([
      { id: 'AAA', name: 'ios 18.0', writerKey: 'w-aaa' }
    ])
    await expect(broadcastAction({})).rejects.toThrow('type is required')
  })

  it('throws when no device entry matches the current writerKey', async () => {
    pearpassVaultClient.activeVaultList.mockResolvedValue([
      { id: 'BBB', name: 'macos 15.0', writerKey: 'w-bbb' }
    ])
    await expect(broadcastAction({ type: 'logout' })).rejects.toThrow(
      'cannot resolve own device id'
    )
  })

  it('queues an outbox entry per peer, excluding self', async () => {
    pearpassVaultClient.activeVaultList.mockResolvedValue([
      { id: 'AAA', name: 'ios 18.0', writerKey: 'w-aaa' },
      { id: 'BBB', name: 'macos 15.0', writerKey: 'w-bbb' },
      { id: 'CCC', name: 'android 14', writerKey: 'w-ccc' }
    ])

    const { results, failures } = await broadcastAction({
      type: 'delete-vault',
      payload: { reason: 'manual' }
    })

    expect(failures).toEqual([])
    expect(results.map((r) => r.targetDeviceId).sort()).toEqual(['BBB', 'CCC'])
    expect(results.every((r) => r.channel === 'outbox')).toBe(true)
    expect(pearpassVaultClient.vaultsAdd).toHaveBeenCalledTimes(2)
    for (const [key] of pearpassVaultClient.vaultsAdd.mock.calls) {
      expect(key.startsWith('actions/outbox/')).toBe(true)
    }
  })

  it('returns empty results when only self is paired', async () => {
    pearpassVaultClient.activeVaultList.mockResolvedValue([
      { id: 'AAA', name: 'ios 18.0', writerKey: 'w-aaa' }
    ])

    const { results, failures } = await broadcastAction({ type: 'logout' })

    expect(results).toEqual([])
    expect(failures).toEqual([])
    expect(pearpassVaultClient.vaultsAdd).not.toHaveBeenCalled()
  })

  it('addresses only the requested targets when a targets list is provided', async () => {
    pearpassVaultClient.activeVaultList.mockResolvedValue([
      { id: 'AAA', name: 'ios 18.0', writerKey: 'w-aaa' },
      { id: 'BBB', name: 'macos 15.0', writerKey: 'w-bbb' },
      { id: 'CCC', name: 'android 14', writerKey: 'w-ccc' }
    ])

    const { results } = await broadcastAction({
      type: 'delete-vault',
      payload: { reason: 'kick' },
      targets: ['BBB']
    })

    expect(results.map((r) => r.targetDeviceId)).toEqual(['BBB'])
    expect(pearpassVaultClient.vaultsAdd).toHaveBeenCalledTimes(1)
  })

  it('ignores targets that are unknown or self', async () => {
    pearpassVaultClient.activeVaultList.mockResolvedValue([
      { id: 'AAA', name: 'ios 18.0', writerKey: 'w-aaa' },
      { id: 'BBB', name: 'macos 15.0', writerKey: 'w-bbb' }
    ])

    const { results } = await broadcastAction({
      type: 'delete-vault',
      payload: {},
      targets: ['AAA', 'UNKNOWN']
    })

    expect(results).toEqual([])
    expect(pearpassVaultClient.vaultsAdd).not.toHaveBeenCalled()
  })

  it('reports partial failures without aborting other targets', async () => {
    pearpassVaultClient.activeVaultList.mockResolvedValue([
      { id: 'AAA', name: 'ios 18.0', writerKey: 'w-aaa' },
      { id: 'BBB', name: 'macos 15.0', writerKey: 'w-bbb' },
      { id: 'CCC', name: 'android 14', writerKey: 'w-ccc' }
    ])

    const boom = new Error('write failed')
    pearpassVaultClient.vaultsAdd.mockImplementation((key) => {
      if (key.includes('/BBB/')) return Promise.reject(boom)
      return Promise.resolve()
    })

    const { results, failures } = await broadcastAction({ type: 'logout' })

    expect(results.map((r) => r.targetDeviceId)).toEqual(['CCC'])
    expect(failures).toEqual([{ targetDeviceId: 'BBB', error: boom }])
    expect(pearpassVaultClient.vaultsAdd).toHaveBeenCalledTimes(2)
  })
})
