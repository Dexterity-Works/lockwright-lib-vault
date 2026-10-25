import { leaveVaultActionHandler } from './leaveVault'
import { getCurrentVault } from '../../api/getCurrentVault'
import { INBOX_PREFIX, processInbox } from '../../api/inbox'
import { listDevices } from '../../api/listDevices'
import { pearpassVaultClient } from '../../instances'

jest.mock('../../api/getCurrentVault', () => ({ getCurrentVault: jest.fn() }))
jest.mock('../../api/listDevices', () => ({ listDevices: jest.fn() }))

describe('leaveVaultActionHandler', () => {
  const SENT_AT = '2026-10-01T00:00:00.000Z'
  const BEFORE = Date.parse(SENT_AT) - 1000
  const AFTER = Date.parse(SENT_AT) + 1000
  const leave = {
    type: 'leave-vault',
    actor: 'B',
    sentAt: SENT_AT,
    payload: { vaultId: 'v1' }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    getCurrentVault.mockResolvedValue({ id: 'v1' })
    pearpassVaultClient.activeVaultGetWriterKey.mockResolvedValue('writer-A')
    pearpassVaultClient.activeVaultRemoveWriter.mockResolvedValue(undefined)
    pearpassVaultClient.activeVaultRemove.mockResolvedValue(undefined)
    pearpassVaultClient.vaultsGet.mockResolvedValue(undefined)
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue({
      vaultId: 'v1',
      legacy: false
    })
    pearpassVaultClient.activeVaultEnsureEpoch.mockResolvedValue({
      rotated: true,
      id: 'e2',
      seq: 2,
      members: ['A'],
      uncovered: []
    })
  })

  it('starts the epoch of a legacy vault before it sweeps the leaver', async () => {
    listDevices.mockResolvedValue([
      { id: 'A', writerKey: 'writer-A' },
      { id: 'B', writerKey: 'writer-B' }
    ])
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue({
      vaultId: 'v1',
      legacy: true
    })
    const calls = []
    pearpassVaultClient.activeVaultEnsureEpoch.mockImplementation(async () => {
      calls.push('ensureEpoch')
      return { rotated: true, id: 'e1', seq: 1, members: [], uncovered: [] }
    })
    pearpassVaultClient.activeVaultRemoveWriter.mockImplementation(async () =>
      calls.push('removeWriter')
    )

    await leaveVaultActionHandler.execute(leave)

    expect(calls).toEqual(['ensureEpoch', 'removeWriter', 'ensureEpoch'])
  })

  it('leaves a legacy vault untouched while its epoch cannot start', async () => {
    listDevices.mockResolvedValue([{ id: 'B', writerKey: 'writer-B' }])
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue({
      vaultId: 'v1',
      legacy: true
    })
    pearpassVaultClient.activeVaultEnsureEpoch.mockResolvedValue({
      rotated: false,
      reason: 'not-writable',
      uncovered: []
    })

    await expect(leaveVaultActionHandler.execute(leave)).rejects.toThrow(
      'cannot start the vault key'
    )
    expect(pearpassVaultClient.activeVaultRemoveWriter).not.toHaveBeenCalled()
    expect(pearpassVaultClient.activeVaultRemove).not.toHaveBeenCalled()
  })

  it('never sweeps another vault when the active vault switches mid-leave', async () => {
    // The switch lands between the vault check and the roster read: the
    // leaver's row in v2 shares its masterTopic.
    listDevices.mockResolvedValue([
      { id: 'A2', vaultId: 'v2', writerKey: 'writer-A2' },
      {
        id: 'B2',
        vaultId: 'v2',
        writerKey: 'writer-B2',
        masterTopic: 'topic-B',
        createdAt: BEFORE
      }
    ])
    pearpassVaultClient.vaultsGet.mockResolvedValue({
      writerKey: 'writer-B',
      masterTopic: 'topic-B'
    })
    getCurrentVault
      .mockResolvedValueOnce({ id: 'v1' })
      .mockResolvedValue({ id: 'v2' })

    await expect(leaveVaultActionHandler.execute(leave)).rejects.toThrow(
      'no longer the active vault'
    )

    expect(pearpassVaultClient.activeVaultRemoveWriter).not.toHaveBeenCalled()
    expect(pearpassVaultClient.activeVaultRemove).not.toHaveBeenCalled()
    expect(pearpassVaultClient.activeVaultEnsureEpoch).not.toHaveBeenCalled()
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

  it('drops the actor row without revoking when it has no writer key', async () => {
    listDevices.mockResolvedValue([{ id: 'B' }])

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

  it('starts the epoch a leaver owed, so a legacy vault does not stay readable to it', async () => {
    // The leaver asked for the first epoch and left before it landed; its
    // owed start leaves with it. Only a start from this member rotates.
    listDevices.mockResolvedValue([
      { id: 'A', writerKey: 'writer-A' },
      { id: 'B', writerKey: 'writer-B' }
    ])
    pearpassVaultClient.activeVaultEnsureEpoch.mockImplementation(
      async ({ start }) =>
        start === true
          ? { rotated: true, id: 'e1', seq: 1, members: ['A'], uncovered: [] }
          : { rotated: false, reason: 'legacy', uncovered: [] }
    )

    await expect(
      leaveVaultActionHandler.execute(leave)
    ).resolves.toBeUndefined()
    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledWith(
      'device/B'
    )
  })

  it('still rotates when the actor row is already gone', async () => {
    listDevices.mockResolvedValue([{ id: 'A', writerKey: 'writer-A' }])

    await leaveVaultActionHandler.execute(leave)

    expect(pearpassVaultClient.activeVaultRemove).not.toHaveBeenCalled()
    expect(pearpassVaultClient.activeVaultEnsureEpoch).toHaveBeenCalledWith({
      start: true
    })
  })

  it('drops every row sharing the leaver writerKey or masterTopic, revoking every swept writer first and the actor row last', async () => {
    listDevices.mockResolvedValue([
      { id: 'A', writerKey: 'writer-A', masterTopic: 't-a' },
      { id: 'B', writerKey: 'writer-B', masterTopic: 't-b' },
      { id: 'B2', writerKey: 'writer-B' },
      {
        id: 'B3',
        writerKey: 'writer-B3',
        masterTopic: 't-b',
        createdAt: BEFORE
      },
      { id: 'C', writerKey: 'writer-C', masterTopic: 't-c' }
    ])
    const calls = []
    pearpassVaultClient.activeVaultRemoveWriter.mockImplementation(async (k) =>
      calls.push(['removeWriter', k])
    )
    pearpassVaultClient.activeVaultRemove.mockImplementation(async (k) =>
      calls.push(['remove', k])
    )

    await leaveVaultActionHandler.execute(leave)

    const writers = calls.filter(([op]) => op === 'removeWriter')
    const removes = calls.filter(([op]) => op === 'remove')
    expect(writers.map(([, k]) => k).sort()).toEqual(['writer-B', 'writer-B3'])
    expect(calls.slice(0, writers.length)).toEqual(writers)
    expect(removes.map(([, k]) => k).sort()).toEqual([
      'device/B',
      'device/B2',
      'device/B3'
    ])
    expect(calls.at(-1)).toEqual(['remove', 'device/B'])
  })

  it('keeps a row sharing the leaver masterTopic that was created after the leave was sent', async () => {
    listDevices.mockResolvedValue([
      { id: 'A', writerKey: 'writer-A' },
      { id: 'B', writerKey: 'writer-B', masterTopic: 't-b', createdAt: BEFORE },
      {
        id: 'B-new',
        writerKey: 'writer-B-new',
        masterTopic: 't-b',
        createdAt: AFTER
      }
    ])

    await leaveVaultActionHandler.execute(leave)

    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledTimes(1)
    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledWith(
      'device/B'
    )
    expect(
      pearpassVaultClient.activeVaultRemoveWriter
    ).not.toHaveBeenCalledWith('writer-B-new')
    expect(pearpassVaultClient.activeVaultEnsureEpoch).toHaveBeenCalledWith({
      start: true
    })
  })

  // Known residual: the actor row is swept with no createdAt check, so a
  // re-join that the by-name heal wrote back under the old id still goes.
  it('sweeps a same-name re-join the heal wrote under the leaver id', async () => {
    listDevices.mockResolvedValue([
      { id: 'A', writerKey: 'writer-A' },
      {
        id: 'B',
        writerKey: 'writer-B-new',
        masterTopic: 't-b',
        createdAt: AFTER
      }
    ])

    await leaveVaultActionHandler.execute(leave)

    expect(pearpassVaultClient.activeVaultRemoveWriter.mock.calls).toEqual([
      ['writer-B-new']
    ])
    expect(pearpassVaultClient.activeVaultRemove.mock.calls).toEqual([
      ['device/B']
    ])
  })

  // Known residual: createdAt and sentAt come from the leaver's clock, so a
  // backward step between the leave and the re-join sweeps the new row.
  it('sweeps a re-join stamped before sentAt after a backward clock step', async () => {
    listDevices.mockResolvedValue([
      { id: 'A', writerKey: 'writer-A' },
      { id: 'B', writerKey: 'writer-B', masterTopic: 't-b', createdAt: BEFORE },
      {
        id: 'B-new',
        writerKey: 'writer-B-new',
        masterTopic: 't-b',
        createdAt: Date.parse(SENT_AT) - 1
      }
    ])

    await leaveVaultActionHandler.execute(leave)

    expect(
      pearpassVaultClient.activeVaultRemoveWriter.mock.calls.flat().sort()
    ).toEqual(['writer-B', 'writer-B-new'])
    expect(pearpassVaultClient.activeVaultRemove.mock.calls).toEqual([
      ['device/B-new'],
      ['device/B']
    ])
  })

  it.each([[undefined], ['not a date']])(
    'matches by writerKey only when sentAt is %p',
    async (sentAt) => {
      listDevices.mockResolvedValue([
        { id: 'A', writerKey: 'writer-A' },
        { id: 'B', writerKey: 'writer-B', masterTopic: 't-b' },
        { id: 'B2', writerKey: 'writer-B' },
        {
          id: 'B3',
          writerKey: 'writer-B3',
          masterTopic: 't-b',
          createdAt: BEFORE
        }
      ])

      await leaveVaultActionHandler.execute({ ...leave, sentAt })

      const removed = pearpassVaultClient.activeVaultRemove.mock.calls.map(
        ([k]) => k
      )
      expect(removed.sort()).toEqual(['device/B', 'device/B2'])
    }
  )

  it('keeps the actor row for the retry when a duplicate delete throws', async () => {
    listDevices.mockResolvedValue([
      { id: 'B', writerKey: 'writer-B' },
      { id: 'B2', writerKey: 'writer-B' }
    ])
    pearpassVaultClient.activeVaultRemove.mockImplementation(async (k) => {
      if (k === 'device/B2') throw new Error('remove failed')
    })

    await expect(leaveVaultActionHandler.execute(leave)).rejects.toThrow(
      'remove failed'
    )
    expect(pearpassVaultClient.activeVaultRemove).not.toHaveBeenCalledWith(
      'device/B'
    )
    expect(pearpassVaultClient.activeVaultEnsureEpoch).not.toHaveBeenCalled()
  })

  it('keeps a row holding our writerKey even when it shares the actor masterTopic', async () => {
    listDevices.mockResolvedValue([
      { id: 'A', writerKey: 'writer-A', masterTopic: 't-b' },
      { id: 'B', writerKey: 'writer-B', masterTopic: 't-b' }
    ])

    await leaveVaultActionHandler.execute(leave)

    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledTimes(1)
    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledWith(
      'device/B'
    )
    expect(pearpassVaultClient.activeVaultRemoveWriter).toHaveBeenCalledWith(
      'writer-B'
    )
    expect(pearpassVaultClient.activeVaultRemoveWriter).toHaveBeenCalledTimes(1)
  })

  it('drops only the actor row when it carries our writerKey', async () => {
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

  it('treats a rotation left to another member as done once the rows are gone', async () => {
    listDevices.mockResolvedValue([{ id: 'B', writerKey: 'writer-B' }])
    pearpassVaultClient.activeVaultEnsureEpoch.mockResolvedValue({
      rotated: false,
      reason: 'pending',
      uncovered: []
    })

    await expect(
      leaveVaultActionHandler.execute(leave)
    ).resolves.toBeUndefined()
    expect(pearpassVaultClient.activeVaultRemove).toHaveBeenCalledWith(
      'device/B'
    )
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

  it('reports a missing rotation result', async () => {
    listDevices.mockResolvedValue([{ id: 'B', writerKey: 'writer-B' }])
    pearpassVaultClient.activeVaultEnsureEpoch.mockResolvedValue(undefined)

    await expect(leaveVaultActionHandler.execute(leave)).rejects.toThrow(
      'epoch rotation failed: no result'
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

  it('sweeps late duplicates from the peer record on a retry after the actor row is gone', async () => {
    const entryKey = `${INBOX_PREFIX}1_leave`
    let record = { envelope: leave }
    let roster = [
      { id: 'A', writerKey: 'writer-A' },
      { id: 'B', writerKey: 'writer-B', masterTopic: 't-b' }
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
    pearpassVaultClient.vaultsGet.mockImplementation(async (key) =>
      key === 'peer/B'
        ? { id: 'B', writerKey: 'writer-B', masterTopic: 't-b' }
        : undefined
    )
    listDevices.mockImplementation(async () => roster)
    const calls = []
    pearpassVaultClient.activeVaultRemoveWriter.mockImplementation(async (k) =>
      calls.push(['removeWriter', k])
    )
    pearpassVaultClient.activeVaultRemove.mockImplementation(async (key) => {
      calls.push(['remove', key])
      roster = roster.filter((d) => `device/${d.id}` !== key)
    })
    pearpassVaultClient.activeVaultEnsureEpoch
      .mockImplementationOnce(async () => {
        calls.push(['ensureEpoch'])
        // A stale row for the leaver replicates in after the first sweep.
        roster = [
          ...roster,
          {
            id: 'B-old',
            writerKey: 'writer-B-old',
            masterTopic: 't-b',
            createdAt: BEFORE
          }
        ]
        throw new Error('rotation failed')
      })
      .mockImplementationOnce(async () => {
        calls.push(['ensureEpoch'])
        return { rotated: true, uncovered: [] }
      })

    await processInbox()
    calls.length = 0
    const second = await processInbox()

    expect(second.processed).toBe(1)
    expect(calls).toEqual([
      ['removeWriter', 'writer-B-old'],
      ['remove', 'device/B-old'],
      ['ensureEpoch']
    ])
    expect(record).toBeNull()
  })

  it('keeps a re-join row created after sentAt on the peer-record retry path', async () => {
    listDevices.mockResolvedValue([
      { id: 'A', writerKey: 'writer-A' },
      {
        id: 'B-old',
        writerKey: 'writer-B-old',
        masterTopic: 't-b',
        createdAt: BEFORE
      },
      {
        id: 'B-new',
        writerKey: 'writer-B-new',
        masterTopic: 't-b',
        createdAt: AFTER
      }
    ])
    pearpassVaultClient.vaultsGet.mockImplementation(async (key) =>
      key === 'peer/B'
        ? { id: 'B', writerKey: 'writer-B', masterTopic: 't-b' }
        : undefined
    )

    await leaveVaultActionHandler.execute(leave)

    expect(pearpassVaultClient.activeVaultRemove.mock.calls).toEqual([
      ['device/B-old']
    ])
    expect(pearpassVaultClient.activeVaultRemoveWriter.mock.calls).toEqual([
      ['writer-B-old']
    ])
  })
})
