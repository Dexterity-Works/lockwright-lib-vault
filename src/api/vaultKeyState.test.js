import { pearpassVaultClient } from '../instances'
import { getVaultKeyState, waitForKeyRotation } from './vaultKeyState'

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

  it('counts every member as removed when the roster lists nothing', async () => {
    pearpassVaultClient.activeVaultList.mockResolvedValue(null)
    pearpassVaultClient.vaultsGet.mockResolvedValue(null)

    const state = await getVaultKeyState()

    expect(state.removed.map((d) => d.id)).toEqual(['A', 'B', 'K'])
  })

  it('reads a status without a member list as no members', async () => {
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(
      status({ members: undefined })
    )

    const state = await getVaultKeyState()

    expect(state.members).toEqual([])
    expect(state.removed).toEqual([])
  })

  it('returns null when the active vault switches during the read', async () => {
    pearpassVaultClient.activeVaultGetEpochStatus
      .mockResolvedValueOnce(status())
      .mockResolvedValue(status({ vaultId: 'v2', members: ['C'] }))

    expect(await getVaultKeyState()).toBeNull()
  })

  it('returns null without a status for a vault', async () => {
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(null)

    expect(await getVaultKeyState()).toBeNull()
  })
})

describe('waitForKeyRotation', () => {
  const statusHandlers = () =>
    pearpassVaultClient.on.mock.calls
      .filter(([event]) => event === 'epoch-status')
      .map(([, handler]) => handler)

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(status())
    pearpassVaultClient.activeVaultList.mockResolvedValue([
      { id: 'A' },
      { id: 'B' }
    ])
    pearpassVaultClient.activeVaultGet.mockResolvedValue({ createdAt: 5 })
    pearpassVaultClient.vaultsGet.mockResolvedValue(null)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  const wait = () =>
    waitForKeyRotation({ vaultId: 'v1', deviceId: 'K', timeoutMs: 50_000 })

  it('resolves at once when the latest key leaves the device out', async () => {
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(
      status({ epoch: 'e3', members: ['A', 'B'] })
    )

    const state = await wait()

    expect(state).toMatchObject({ epoch: 'e3', rotatedAt: 5, removed: [] })
    expect(pearpassVaultClient.off).toHaveBeenCalledWith(
      'epoch-status',
      statusHandlers()[0]
    )
  })

  it('resolves on the epoch-status that shows the rotation', async () => {
    const result = wait()
    await jest.advanceTimersByTimeAsync(0)
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(
      status({ epoch: 'e3', members: ['A', 'B'] })
    )

    statusHandlers()[0]({ vaultId: 'v1' })

    await expect(result).resolves.toMatchObject({ epoch: 'e3' })
  })

  it('ignores an epoch-status for another vault', async () => {
    const result = wait()
    await jest.advanceTimersByTimeAsync(0)
    pearpassVaultClient.activeVaultGetEpochStatus.mockClear()

    statusHandlers()[0]({ vaultId: 'v2' })
    await jest.advanceTimersByTimeAsync(0)

    expect(pearpassVaultClient.activeVaultGetEpochStatus).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(50_000)
    await expect(result).resolves.toBeNull()
  })

  it('does not count a new key that still reaches another removed device', async () => {
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(
      status({ epoch: 'e3', members: ['A', 'B', 'X'] })
    )

    const result = wait()
    await jest.advanceTimersByTimeAsync(50_000)

    await expect(result).resolves.toBeNull()
  })

  it('does not count a legacy vault or a status for another vault', async () => {
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(
      status({ epoch: null, legacy: true, members: [] })
    )
    const legacy = wait()
    await jest.advanceTimersByTimeAsync(50_000)
    await expect(legacy).resolves.toBeNull()

    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(
      status({ vaultId: 'v2', epoch: 'e3', members: ['A', 'B'] })
    )
    const other = wait()
    await jest.advanceTimersByTimeAsync(50_000)
    await expect(other).resolves.toBeNull()
  })

  it('resolves null at the deadline and stops listening', async () => {
    const result = wait()
    await jest.advanceTimersByTimeAsync(49_999)
    expect(pearpassVaultClient.off).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(1)

    await expect(result).resolves.toBeNull()
    expect(pearpassVaultClient.off).toHaveBeenCalledWith(
      'epoch-status',
      statusHandlers()[0]
    )
  })

  it('resolves null when aborted', async () => {
    const controller = new AbortController()
    const result = waitForKeyRotation({
      vaultId: 'v1',
      deviceId: 'K',
      timeoutMs: 50_000,
      signal: controller.signal
    })

    controller.abort()

    await expect(result).resolves.toBeNull()
    expect(pearpassVaultClient.off).toHaveBeenCalled()
  })

  it('resolves null at once for a signal that is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      waitForKeyRotation({
        vaultId: 'v1',
        deviceId: 'K',
        timeoutMs: 50_000,
        signal: controller.signal
      })
    ).resolves.toBeNull()
    expect(pearpassVaultClient.activeVaultGetEpochStatus).not.toHaveBeenCalled()
  })

  it('does not count a status with no latest epoch while a rotation is owed', async () => {
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(
      status({ epoch: null, legacy: false, members: [] })
    )

    const result = wait()
    await jest.advanceTimersByTimeAsync(50_000)

    await expect(result).resolves.toBeNull()
  })

  it('does not count a legacy status whose members leave the device out', async () => {
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(
      status({ epoch: 'e3', legacy: true, members: ['A', 'B'] })
    )

    const result = wait()
    await jest.advanceTimersByTimeAsync(50_000)

    await expect(result).resolves.toBeNull()
  })

  it('does not count a key that still includes the device itself', async () => {
    pearpassVaultClient.activeVaultList.mockResolvedValue([
      { id: 'A' },
      { id: 'B' },
      { id: 'K' }
    ])

    const result = wait()
    await jest.advanceTimersByTimeAsync(50_000)

    await expect(result).resolves.toBeNull()
  })

  it('settles once when two status reads both see the rotation', async () => {
    const result = wait()
    await jest.advanceTimersByTimeAsync(0)
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(
      status({ epoch: 'e3', members: ['A', 'B'] })
    )

    statusHandlers()[0]({ vaultId: 'v1' })
    statusHandlers()[0]({ vaultId: 'v1' })

    await expect(result).resolves.toMatchObject({ epoch: 'e3' })
    await jest.advanceTimersByTimeAsync(0)
    expect(pearpassVaultClient.off).toHaveBeenCalledTimes(1)
  })

  it('keeps waiting when a status read fails', async () => {
    pearpassVaultClient.activeVaultGetEpochStatus.mockRejectedValueOnce(
      new Error('boom')
    )
    const result = wait()
    await jest.advanceTimersByTimeAsync(0)
    pearpassVaultClient.activeVaultGetEpochStatus.mockResolvedValue(
      status({ epoch: 'e3', members: ['A', 'B'] })
    )

    statusHandlers()[0]({ vaultId: 'v1' })

    await expect(result).resolves.toMatchObject({ epoch: 'e3' })
  })
})
