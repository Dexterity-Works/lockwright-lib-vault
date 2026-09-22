jest.mock(
  'lockwright-utils-generate-unique-id',
  () => ({ generateUniqueId: jest.fn(() => 'fixed-id') }),
  { virtual: true }
)

jest.mock('./broadcastAction', () => ({
  decodeEnvelope: jest.fn()
}))

jest.mock('../utils/getMyDeviceId', () => ({
  getMyDeviceId: jest.fn().mockResolvedValue('me')
}))

const mockHandlerSpy = jest.fn()
jest.mock('../actions', () => ({
  ACTIONS: {
    'delete-vault': { execute: (...args) => mockHandlerSpy(...args) }
  }
}))

import { decodeEnvelope } from './broadcastAction'
import {
  acceptInboundEnvelope,
  INBOX_PREFIX,
  INBOX_QUARANTINE_PREFIX,
  processInbox,
  SEEN_PREFIX
} from './inbox'
import { pearpassVaultClient } from '../instances'

describe('acceptInboundEnvelope', () => {
  beforeEach(() => {
    decodeEnvelope.mockReset()
    pearpassVaultClient.vaultsAdd.mockReset()
    pearpassVaultClient.vaultsGet.mockReset()
  })

  it('drops envelopes that fail decode/verify', async () => {
    decodeEnvelope.mockResolvedValue(null)
    await acceptInboundEnvelope({ envelope: 'wrapper-hex' })
    expect(pearpassVaultClient.vaultsAdd).not.toHaveBeenCalled()
  })

  it('drops envelopes whose actor matches our own deviceId', async () => {
    decodeEnvelope.mockResolvedValue({
      id: 'e1',
      type: 'delete-vault',
      actor: 'me'
    })
    await acceptInboundEnvelope({ envelope: 'wrapper-hex' })
    expect(pearpassVaultClient.vaultsAdd).not.toHaveBeenCalled()
  })

  it('drops envelopes already seen on (actor, id)', async () => {
    decodeEnvelope.mockResolvedValue({
      id: 'e1',
      type: 'delete-vault',
      actor: 'peer-A'
    })
    pearpassVaultClient.vaultsGet.mockResolvedValue({ seenAt: Date.now() })

    await acceptInboundEnvelope({ envelope: 'wrapper-hex' })

    expect(pearpassVaultClient.vaultsGet).toHaveBeenCalledWith(
      `${SEEN_PREFIX}peer-A/e1`
    )
    expect(pearpassVaultClient.vaultsAdd).not.toHaveBeenCalled()
  })

  it('persists envelope to the inbox and marks (actor, id) seen', async () => {
    decodeEnvelope.mockResolvedValue({
      id: 'e1',
      type: 'delete-vault',
      actor: 'peer-A'
    })
    pearpassVaultClient.vaultsGet.mockResolvedValue(null)

    await acceptInboundEnvelope({ envelope: 'wrapper-hex' })

    const calls = pearpassVaultClient.vaultsAdd.mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][0].startsWith(INBOX_PREFIX)).toBe(true)
    expect(calls[1][0]).toBe(`${SEEN_PREFIX}peer-A/e1`)
  })

  it('uses fixed-width timestamps for ordering', async () => {
    decodeEnvelope.mockResolvedValue({
      id: 'e1',
      type: 'delete-vault',
      actor: 'peer-A'
    })
    pearpassVaultClient.vaultsGet.mockResolvedValue(null)
    const now = jest.spyOn(Date, 'now').mockReturnValue(1234567890123)

    await acceptInboundEnvelope({ envelope: 'wrapper-hex' })

    const key = pearpassVaultClient.vaultsAdd.mock.calls[0][0]
    expect(key).toBe(`${INBOX_PREFIX}1234567890123_fixed-id`)
    now.mockRestore()
  })
})

describe('processInbox', () => {
  beforeEach(() => {
    mockHandlerSpy.mockReset()
    pearpassVaultClient.vaultsFind.mockReset()
    pearpassVaultClient.vaultsAdd.mockReset()
    pearpassVaultClient.vaultsRemove.mockReset()
  })

  const entry = (key, value) => ({ key, value })
  const inboxScan = (entries) =>
    pearpassVaultClient.vaultsFind.mockImplementation(async (opts) => {
      if (opts?.gte?.key?.startsWith(INBOX_PREFIX)) return entries
      return []
    })

  it('drops the entry on successful execution', async () => {
    inboxScan([
      entry(`${INBOX_PREFIX}1_a`, {
        envelope: { type: 'delete-vault', actor: 'peer-A', id: 'e1' }
      })
    ])
    mockHandlerSpy.mockResolvedValue(undefined)

    const result = await processInbox()

    expect(result.processed).toBe(1)
    expect(pearpassVaultClient.vaultsRemove).toHaveBeenCalledWith(
      `${INBOX_PREFIX}1_a`
    )
  })

  it('keeps the entry on { status: deferred } without bumping attempts', async () => {
    inboxScan([
      entry(`${INBOX_PREFIX}1_a`, {
        envelope: { type: 'delete-vault', actor: 'peer-A', id: 'e1' }
      })
    ])
    mockHandlerSpy.mockResolvedValue({ status: 'deferred' })

    const result = await processInbox()

    expect(result.deferred).toBe(1)
    expect(pearpassVaultClient.vaultsRemove).not.toHaveBeenCalled()
    expect(pearpassVaultClient.vaultsAdd).not.toHaveBeenCalled()
  })

  it('bumps attempts on throw and keeps the entry below the cap', async () => {
    inboxScan([
      entry(`${INBOX_PREFIX}1_a`, {
        attempts: 2,
        envelope: { type: 'delete-vault', actor: 'peer-A', id: 'e1' }
      })
    ])
    mockHandlerSpy.mockRejectedValue(new Error('boom'))

    const result = await processInbox()

    expect(result.failed).toBe(1)
    expect(pearpassVaultClient.vaultsAdd).toHaveBeenCalledWith(
      `${INBOX_PREFIX}1_a`,
      expect.objectContaining({ attempts: 3, lastError: 'boom' })
    )
    expect(pearpassVaultClient.vaultsRemove).not.toHaveBeenCalled()
  })

  it('quarantines past the attempt cap', async () => {
    inboxScan([
      entry(`${INBOX_PREFIX}1_a`, {
        attempts: 4,
        envelope: { type: 'delete-vault', actor: 'peer-A', id: 'e1' }
      })
    ])
    mockHandlerSpy.mockRejectedValue(new Error('still bad'))

    const result = await processInbox()

    expect(result.quarantined).toBe(1)
    const addedKeys = pearpassVaultClient.vaultsAdd.mock.calls.map((c) => c[0])
    expect(addedKeys).toContain(`${INBOX_QUARANTINE_PREFIX}1_a`)
    expect(pearpassVaultClient.vaultsRemove).toHaveBeenCalledWith(
      `${INBOX_PREFIX}1_a`
    )
  })

  it('skips entries whose type has no registered handler', async () => {
    inboxScan([
      entry(`${INBOX_PREFIX}1_a`, {
        envelope: { type: 'unknown-action', actor: 'peer-A', id: 'e1' }
      })
    ])

    const result = await processInbox()

    expect(result.skipped).toBe(1)
    expect(pearpassVaultClient.vaultsRemove).not.toHaveBeenCalled()
  })

  it('returns zeros and does not throw if the master vault is not initialised', async () => {
    pearpassVaultClient.vaultsFind.mockRejectedValue(
      new Error('Vaults not initialised')
    )
    const result = await processInbox()
    expect(result).toEqual({
      processed: 0,
      skipped: 0,
      deferred: 0,
      failed: 0,
      quarantined: 0
    })
  })
})
