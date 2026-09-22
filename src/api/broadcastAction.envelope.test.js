jest.mock(
  'lockwright-utils-generate-unique-id',
  () => ({ generateUniqueId: jest.fn(() => 'fixed-id') }),
  { virtual: true }
)

jest.mock('../actions', () => ({
  ACTION_TYPES: { LOGOUT: 'logout', DELETE_VAULT: 'delete-vault' }
}))

import { decodeEnvelope, encodeEnvelope } from './broadcastAction'
import { pearpassVaultClient } from '../instances'

const SIG = 'a'.repeat(128)
const PEER_TOPIC = 'b'.repeat(64)

describe('encodeEnvelope', () => {
  beforeEach(() => {
    pearpassVaultClient.signMessage.mockReset()
    pearpassVaultClient.signMessage.mockResolvedValue(SIG)
  })

  it('signs the hex of the body JSON and wraps in a hex JSON envelope', async () => {
    const body = {
      id: 'env-1',
      type: 'delete-vault',
      payload: { vaultId: 'v1' },
      actor: 'AAA',
      sentAt: '2026-05-16T00:00:00.000Z'
    }
    const wrapperHex = await encodeEnvelope(body)
    const wrapperJson = Buffer.from(wrapperHex, 'hex').toString('utf8')
    const wrapper = JSON.parse(wrapperJson)

    expect(wrapper.signature).toBe(SIG)
    expect(pearpassVaultClient.signMessage).toHaveBeenCalledWith(
      wrapper.envelope
    )

    const bodyJson = Buffer.from(wrapper.envelope, 'hex').toString('utf8')
    expect(JSON.parse(bodyJson)).toEqual(body)
  })
})

describe('decodeEnvelope', () => {
  beforeEach(() => {
    pearpassVaultClient.signMessage.mockReset()
    pearpassVaultClient.signMessage.mockResolvedValue(SIG)
    pearpassVaultClient.verifySignature.mockReset()
    pearpassVaultClient.vaultsGet.mockReset()
    pearpassVaultClient.activeVaultList.mockReset()
  })

  const buildWrapper = async (body) => encodeEnvelope(body)

  it('returns the body when the actor and signature verify', async () => {
    pearpassVaultClient.vaultsGet.mockResolvedValue({ masterTopic: PEER_TOPIC })
    pearpassVaultClient.verifySignature.mockResolvedValue(true)

    const body = {
      id: 'env-1',
      type: 'delete-vault',
      payload: { vaultId: 'v1' },
      actor: 'AAA',
      sentAt: 't'
    }
    const wrapper = await buildWrapper(body)

    const decoded = await decodeEnvelope(wrapper)
    expect(decoded).toEqual(body)
    expect(pearpassVaultClient.verifySignature).toHaveBeenCalledWith(
      expect.any(String),
      SIG,
      PEER_TOPIC
    )
  })

  it('returns null when the actor is unknown', async () => {
    pearpassVaultClient.vaultsGet.mockResolvedValue(null)
    pearpassVaultClient.activeVaultList.mockResolvedValue([])

    const body = { id: 'env-1', type: 'delete-vault', actor: 'AAA' }
    const wrapper = await buildWrapper(body)

    const decoded = await decodeEnvelope(wrapper)
    expect(decoded).toBeNull()
    expect(pearpassVaultClient.verifySignature).not.toHaveBeenCalled()
  })

  it('returns null when the signature does not verify', async () => {
    pearpassVaultClient.vaultsGet.mockResolvedValue({ masterTopic: PEER_TOPIC })
    pearpassVaultClient.verifySignature.mockResolvedValue(false)

    const body = { id: 'env-1', type: 'delete-vault', actor: 'AAA' }
    const wrapper = await buildWrapper(body)

    const decoded = await decodeEnvelope(wrapper)
    expect(decoded).toBeNull()
  })

  it('returns null when the wrapper is missing envelope or signature', async () => {
    const halfWrapper = Buffer.from(
      JSON.stringify({ envelope: 'abcd' }),
      'utf8'
    ).toString('hex')
    expect(await decodeEnvelope(halfWrapper)).toBeNull()

    const onlySig = Buffer.from(
      JSON.stringify({ signature: SIG }),
      'utf8'
    ).toString('hex')
    expect(await decodeEnvelope(onlySig)).toBeNull()
  })

  it('returns null when the body bytes have been tampered with', async () => {
    pearpassVaultClient.vaultsGet.mockResolvedValue({ masterTopic: PEER_TOPIC })
    // Verifier rejects a wrong-hex body even though the wrapper parses fine.
    pearpassVaultClient.verifySignature.mockResolvedValue(false)

    const body = { id: 'env-1', type: 'delete-vault', actor: 'AAA' }
    const wrapper = await buildWrapper(body)

    const wrapperJson = Buffer.from(wrapper, 'hex').toString('utf8')
    const parsed = JSON.parse(wrapperJson)
    const tamperedBody = Buffer.from(
      JSON.stringify({ ...body, payload: { vaultId: 'mutated' } }),
      'utf8'
    ).toString('hex')
    const tamperedHex = Buffer.from(
      JSON.stringify({ ...parsed, envelope: tamperedBody }),
      'utf8'
    ).toString('hex')

    const decoded = await decodeEnvelope(tamperedHex)
    expect(decoded).toBeNull()
  })

  it('returns null when the wrapper hex is not valid JSON', async () => {
    const garbage = '00112233'
    expect(await decodeEnvelope(garbage)).toBeNull()
  })

  it('skips verification when verify is explicitly false', async () => {
    const body = { id: 'env-1', type: 'delete-vault', actor: 'AAA' }
    const wrapper = await buildWrapper(body)

    const decoded = await decodeEnvelope(wrapper, { verify: false })
    expect(decoded).toEqual(body)
    expect(pearpassVaultClient.verifySignature).not.toHaveBeenCalled()
    expect(pearpassVaultClient.vaultsGet).not.toHaveBeenCalled()
  })
})
