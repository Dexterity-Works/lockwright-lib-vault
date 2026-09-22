jest.mock(
  'lockwright-utils-generate-unique-id',
  () => ({ generateUniqueId: jest.fn(() => 'fixed-id') }),
  { virtual: true }
)

jest.mock('./broadcastAction', () => ({
  encodeEnvelope: jest.fn().mockResolvedValue('wrapper-hex')
}))

import { outboxAppend, OUTBOX_PREFIX, processOutbox } from './outbox'
import { pearpassVaultClient } from '../instances'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

describe('outboxAppend', () => {
  beforeEach(() => {
    pearpassVaultClient.vaultsAdd.mockReset()
  })

  it('writes a record per target keyed under actions/outbox/<deviceId>/', async () => {
    const record = await outboxAppend({
      targetDeviceId: 'peer-A',
      targetTopic: 'topic-A',
      envelopeBase: { type: 'delete-vault', actor: 'me', id: 'env-1' }
    })

    expect(record.targetDeviceId).toBe('peer-A')
    expect(record.targetTopic).toBe('topic-A')
    expect(record.attempts).toBe(0)

    const [key, value] = pearpassVaultClient.vaultsAdd.mock.calls[0]
    expect(key.startsWith(`${OUTBOX_PREFIX}peer-A/`)).toBe(true)
    expect(value.envelopeBase.id).toBe('env-1')
  })

  it('throws when targetDeviceId is missing', async () => {
    await expect(outboxAppend({ envelopeBase: { type: 'x' } })).rejects.toThrow(
      'targetDeviceId is required'
    )
  })
})

describe('processOutbox', () => {
  beforeEach(() => {
    pearpassVaultClient.vaultsFind.mockReset()
    pearpassVaultClient.vaultsAdd.mockReset()
    pearpassVaultClient.vaultsRemove.mockReset()
    pearpassVaultClient.personalSwarmSend.mockReset()
  })

  const entry = (key, value) => ({ key, value })

  it('drops on successful send', async () => {
    const now = Date.now()
    pearpassVaultClient.vaultsFind.mockResolvedValue([
      entry(`${OUTBOX_PREFIX}peer-A/1`, {
        targetDeviceId: 'peer-A',
        targetTopic: 'topic-A',
        envelopeBase: { id: 'env-1', type: 'delete-vault' },
        firstTry: now,
        attempts: 0,
        nextRetry: now
      })
    ])
    pearpassVaultClient.personalSwarmSend.mockResolvedValue({ ok: true })

    const result = await processOutbox()

    expect(result.drained).toBe(1)
    expect(pearpassVaultClient.vaultsRemove).toHaveBeenCalledWith(
      `${OUTBOX_PREFIX}peer-A/1`
    )
  })

  it('bumps and reschedules on send failure inside the fast phase (1m)', async () => {
    const now = 1_700_000_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)

    pearpassVaultClient.vaultsFind.mockResolvedValue([
      entry(`${OUTBOX_PREFIX}peer-A/1`, {
        targetDeviceId: 'peer-A',
        targetTopic: 'topic-A',
        envelopeBase: { id: 'env-1', type: 'delete-vault' },
        // Past the first-retry jitter so this becomes a fast-phase retry.
        firstTry: now - 60_000,
        attempts: 2,
        nextRetry: now
      })
    ])
    pearpassVaultClient.personalSwarmSend.mockResolvedValue({
      ok: false,
      reason: 'lookup-timeout'
    })

    const result = await processOutbox()

    expect(result.retried).toBe(1)
    const [, updated] = pearpassVaultClient.vaultsAdd.mock.calls[0]
    expect(updated.attempts).toBe(3)
    // Fast phase: 1 minute.
    expect(updated.nextRetry).toBe(now + 60 * 1000)

    Date.now.mockRestore()
  })

  it('switches to slow-phase (1h) past 7 days', async () => {
    const now = 1_700_000_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)

    pearpassVaultClient.vaultsFind.mockResolvedValue([
      entry(`${OUTBOX_PREFIX}peer-A/1`, {
        targetDeviceId: 'peer-A',
        targetTopic: 'topic-A',
        envelopeBase: { id: 'env-1', type: 'delete-vault' },
        firstTry: now - 10 * DAY_MS,
        attempts: 200,
        nextRetry: now
      })
    ])
    pearpassVaultClient.personalSwarmSend.mockResolvedValue({ ok: false })

    await processOutbox()

    const [, updated] = pearpassVaultClient.vaultsAdd.mock.calls[0]
    expect(updated.nextRetry).toBe(now + HOUR_MS)

    Date.now.mockRestore()
  })

  it('drops entries past the 30-day grace window', async () => {
    const now = 1_700_000_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)

    pearpassVaultClient.vaultsFind.mockResolvedValue([
      entry(`${OUTBOX_PREFIX}peer-A/1`, {
        targetDeviceId: 'peer-A',
        targetTopic: 'topic-A',
        envelopeBase: { id: 'env-1', type: 'delete-vault' },
        firstTry: now - 31 * DAY_MS,
        attempts: 1000,
        nextRetry: now
      })
    ])

    const result = await processOutbox()

    expect(result.dropped).toBe(1)
    expect(pearpassVaultClient.vaultsRemove).toHaveBeenCalledWith(
      `${OUTBOX_PREFIX}peer-A/1`
    )
    expect(pearpassVaultClient.personalSwarmSend).not.toHaveBeenCalled()
  })

  it('skips entries with no targetTopic but still bumps for later retry', async () => {
    const now = 1_700_000_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)

    pearpassVaultClient.vaultsFind.mockResolvedValue([
      entry(`${OUTBOX_PREFIX}peer-A/1`, {
        targetDeviceId: 'peer-A',
        targetTopic: null,
        envelopeBase: { id: 'env-1', type: 'delete-vault' },
        firstTry: now,
        attempts: 0,
        nextRetry: now
      })
    ])

    const result = await processOutbox()

    expect(result.retried).toBe(1)
    expect(pearpassVaultClient.personalSwarmSend).not.toHaveBeenCalled()
    expect(pearpassVaultClient.vaultsAdd).toHaveBeenCalled()

    Date.now.mockRestore()
  })

  it('skips entries whose nextRetry is still in the future', async () => {
    const now = 1_700_000_000_000
    jest.spyOn(Date, 'now').mockReturnValue(now)

    pearpassVaultClient.vaultsFind.mockResolvedValue([
      entry(`${OUTBOX_PREFIX}peer-A/1`, {
        targetDeviceId: 'peer-A',
        targetTopic: 'topic-A',
        envelopeBase: { id: 'env-1', type: 'delete-vault' },
        firstTry: now,
        attempts: 1,
        nextRetry: now + 30_000
      })
    ])

    const result = await processOutbox()

    expect(result.drained).toBe(0)
    expect(result.retried).toBe(0)
    expect(pearpassVaultClient.personalSwarmSend).not.toHaveBeenCalled()

    Date.now.mockRestore()
  })
})
