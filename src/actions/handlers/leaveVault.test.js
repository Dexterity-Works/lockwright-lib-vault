import { leaveVaultActionHandler } from './leaveVault'
import { getCurrentVault } from '../../api/getCurrentVault'
import { INBOX_PREFIX, processInbox } from '../../api/inbox'
import { listDevices } from '../../api/listDevices'
import { pearpassVaultClient } from '../../instances'

jest.mock('../../api/getCurrentVault', () => ({ getCurrentVault: jest.fn() }))
jest.mock('../../api/listDevices', () => ({ listDevices: jest.fn() }))

describe('leaveVaultActionHandler', () => {
  const leave = { type: 'leave-vault', actor: 'B', payload: { vaultId: 'v1' } }

  beforeEach(() => {
    jest.clearAllMocks()
    getCurrentVault.mockResolvedValue({ id: 'v1' })
    pearpassVaultClient.activeVaultGetWriterKey.mockResolvedValue('writer-A')
    pearpassVaultClient.activeVaultRemoveWriter.mockResolvedValue(undefined)
    pearpassVaultClient.activeVaultRemove.mockResolvedValue(undefined)
    pearpassVaultClient.activeVaultEnsureEpoch.mockResolvedValue({
      rotated: true,
      id: 'e2',
      seq: 2,
      members: ['A'],
      uncovered: []
    })
  })

  it('revokes the leaver as a writer before dropping its device row', async () => {
    listDevices.mockResolvedValue([
      { id: 'A', writerKey: 'writer-A' },
      { id: 'B', writerKey: 'writer-B' }
    ])
    const calls = []
    pearpassVaultClient.activeVaultRemoveWriter.mockImplementation(async (k) =>
      calls.push(['removeWriter', k])
    )
    pearpassVaultClient.activeVaultRemove.mockImplementation(async (k) =>
      calls.push(['remove', k])
    )

    await leaveVaultActionHandler.execute(leave)

    expect(calls).toEqual([
      ['removeWriter', 'writer-B'],
      ['remove', 'device/B']
    ])
  })

  it('keeps the device row, so the owner can still kick, when revoke fails', async () => {
    listDevices.mockResolvedValue([{ id: 'B', writerKey: 'writer-B' }])
    pearpassVaultClient.activeVaultRemoveWriter.mockRejectedValue(
      new Error('Not writable')
    )

    await expect(leaveVaultActionHandler.execute(leave)).rejects.toThrow(
      'Not writable'
    )
    expect(pearpassVaultClient.activeVaultRemove).not.toHaveBeenCalled()
  })

  it('never revokes its own writer from a leave by another device', async () => {
    listDevices.mockResolvedValue([{ id: 'B', writerKey: 'writer-A' }])

    await leaveVaultActionHandler.execute(leave)

    expect(pearpassVaultClient.activeVaultRemoveWriter).not.toHaveBeenCalled()
    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledWith(
      'device/B'
    )
  })

  it('rotates the epoch after dropping the device row', async () => {
    listDevices.mockResolvedValue([{ id: 'B', writerKey: 'writer-B' }])
    const calls = []
    pearpassVaultClient.activeVaultRemove.mockImplementation(async (k) =>
      calls.push(['remove', k])
    )
    pearpassVaultClient.activeVaultEnsureEpoch.mockImplementation(async (o) => {
      calls.push(['ensureEpoch', o])
      return { rotated: true, uncovered: [] }
    })

    await leaveVaultActionHandler.execute(leave)

    expect(calls).toEqual([
      ['remove', 'device/B'],
      ['ensureEpoch', { start: true }]
    ])
  })

  it('still rotates when the actor row is already gone', async () => {
    listDevices.mockResolvedValue([{ id: 'A', writerKey: 'writer-A' }])

    await leaveVaultActionHandler.execute(leave)

    expect(pearpassVaultClient.activeVaultRemove).not.toHaveBeenCalled()
    expect(pearpassVaultClient.activeVaultEnsureEpoch).toHaveBeenCalledWith({
      start: true
    })
  })

  it('drops every row sharing the leaver writerKey or masterTopic', async () => {
    listDevices.mockResolvedValue([
      { id: 'A', writerKey: 'writer-A', masterTopic: 't-a' },
      { id: 'B', writerKey: 'writer-B', masterTopic: 't-b' },
      { id: 'B2', writerKey: 'writer-B' },
      { id: 'B3', masterTopic: 't-b' },
      { id: 'C', writerKey: 'writer-C', masterTopic: 't-c' }
    ])

    await leaveVaultActionHandler.execute(leave)

    const removed = pearpassVaultClient.activeVaultRemove.mock.calls.map(
      ([k]) => k
    )
    expect(removed.sort()).toEqual(['device/B', 'device/B2', 'device/B3'])
  })

  it('does not drop our own rows when the actor row carries our writerKey', async () => {
    listDevices.mockResolvedValue([
      { id: 'A', writerKey: 'writer-A' },
      { id: 'B', writerKey: 'writer-A' }
    ])

    await leaveVaultActionHandler.execute(leave)

    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledTimes(1)
    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledWith(
      'device/B'
    )
  })

  it('treats an already current epoch as done', async () => {
    listDevices.mockResolvedValue([{ id: 'B', writerKey: 'writer-B' }])
    pearpassVaultClient.activeVaultEnsureEpoch.mockResolvedValue({
      rotated: false,
      reason: 'current',
      uncovered: []
    })

    await expect(
      leaveVaultActionHandler.execute(leave)
    ).resolves.toBeUndefined()
  })

  it('defers while another member has to rotate', async () => {
    listDevices.mockResolvedValue([{ id: 'B', writerKey: 'writer-B' }])
    pearpassVaultClient.activeVaultEnsureEpoch.mockResolvedValue({
      rotated: false,
      reason: 'pending',
      uncovered: []
    })

    await expect(leaveVaultActionHandler.execute(leave)).resolves.toEqual({
      status: 'deferred',
      reason: 'epoch-pending'
    })
  })

  it('throws on any other rotation that did not happen', async () => {
    listDevices.mockResolvedValue([{ id: 'B', writerKey: 'writer-B' }])
    pearpassVaultClient.activeVaultEnsureEpoch.mockResolvedValue({
      rotated: false,
      reason: 'not-writable',
      uncovered: []
    })

    await expect(leaveVaultActionHandler.execute(leave)).rejects.toThrow(
      'not-writable'
    )
  })

  it('lets a rotation failure propagate so the inbox retries', async () => {
    listDevices.mockResolvedValue([{ id: 'B', writerKey: 'writer-B' }])
    pearpassVaultClient.activeVaultEnsureEpoch.mockRejectedValueOnce(
      new Error('rotation failed')
    )

    await expect(leaveVaultActionHandler.execute(leave)).rejects.toThrow(
      'rotation failed'
    )
  })

  it('rotates on the inbox retry after a rotation threw past the row removal', async () => {
    const entryKey = `${INBOX_PREFIX}1_leave`
    let record = { envelope: leave }
    let roster = [
      { id: 'A', writerKey: 'writer-A' },
      { id: 'B', writerKey: 'writer-B' }
    ]
    pearpassVaultClient.vaultsFind.mockImplementation(async (opts) =>
      opts?.gte?.key === INBOX_PREFIX && record
        ? [{ key: entryKey, value: record }]
        : []
    )
    pearpassVaultClient.vaultsAdd.mockImplementation(async (key, value) => {
      if (key === entryKey) record = value
    })
    pearpassVaultClient.vaultsRemove.mockImplementation(async (key) => {
      if (key === entryKey) record = null
    })
    listDevices.mockImplementation(async () => roster)
    pearpassVaultClient.activeVaultRemove.mockImplementation(async (key) => {
      roster = roster.filter((d) => `device/${d.id}` !== key)
    })
    pearpassVaultClient.activeVaultEnsureEpoch
      .mockRejectedValueOnce(new Error('rotation failed'))
      .mockResolvedValueOnce({ rotated: true, uncovered: [] })

    const first = await processInbox()
    const second = await processInbox()

    expect(first.failed).toBe(1)
    expect(second.processed).toBe(1)
    expect(pearpassVaultClient.activeVaultEnsureEpoch).toHaveBeenCalledTimes(2)
    expect(record).toBeNull()
  })
})
