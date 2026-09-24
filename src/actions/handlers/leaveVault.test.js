import { leaveVaultActionHandler } from './leaveVault'
import { getCurrentVault } from '../../api/getCurrentVault'
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
})
