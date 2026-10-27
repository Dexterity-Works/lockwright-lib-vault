import { runActionScan } from './actionRunner'
import { logger } from '../utils/logger'

const mockProcessInbox = jest.fn()
const mockProcessOutbox = jest.fn()

jest.mock('./inbox', () => ({
  processInbox: (...args) => mockProcessInbox(...args)
}))
jest.mock('./outbox', () => ({
  processOutbox: (...args) => mockProcessOutbox(...args)
}))

jest.spyOn(logger, 'error').mockImplementation(() => {})

describe('actionRunner', () => {
  beforeEach(() => {
    mockProcessInbox.mockReset()
    mockProcessOutbox.mockReset()
    logger.error.mockClear()
  })

  it('calls processInbox and processOutbox', async () => {
    mockProcessInbox.mockResolvedValue(undefined)
    mockProcessOutbox.mockResolvedValue(undefined)
    await runActionScan()
    expect(mockProcessInbox).toHaveBeenCalledTimes(1)
    expect(mockProcessOutbox).toHaveBeenCalledTimes(1)
  })

  it('coalesces overlapping calls via single-flight + pendingRescan', async () => {
    let resolveFirst
    mockProcessInbox
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockResolvedValue(undefined)
    mockProcessOutbox.mockResolvedValue(undefined)

    const first = runActionScan()
    await new Promise((r) => setTimeout(r, 0))

    const second = runActionScan()
    const third = runActionScan()

    resolveFirst()
    await Promise.all([first, second, third])

    expect(mockProcessInbox).toHaveBeenCalledTimes(2)
  })

  it('scans again when the earliest inbox retry is due', async () => {
    jest.useFakeTimers()
    try {
      mockProcessInbox
        .mockResolvedValueOnce({ nextDueAt: Date.now() + 5_000 })
        .mockResolvedValue({ nextDueAt: null })
      mockProcessOutbox.mockResolvedValue(undefined)

      await runActionScan()
      expect(mockProcessInbox).toHaveBeenCalledTimes(1)
      await jest.advanceTimersByTimeAsync(5_000)

      expect(mockProcessInbox).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
    }
  })

  it('swallows processInbox errors and continues', async () => {
    mockProcessInbox.mockRejectedValueOnce(new Error('boom'))
    mockProcessOutbox.mockResolvedValue(undefined)

    await expect(runActionScan()).resolves.toBeUndefined()
    expect(mockProcessInbox).toHaveBeenCalledTimes(1)
    expect(mockProcessOutbox).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      'runActionScan: processInbox failed',
      expect.any(Error)
    )
  })
})
