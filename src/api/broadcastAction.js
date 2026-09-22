import { generateUniqueId } from 'lockwright-utils-generate-unique-id'

import { ACTION_TYPES } from '../actions'
import { pearpassVaultClient } from '../instances'
import { listDevices } from './listDevices'
import { outboxAppend } from './outbox'
import { getMyDeviceId } from '../utils/getMyDeviceId'
import { logger } from '../utils/logger'

/**
 * Persist one outbox envelope per peer and kick the action runner. The actual
 * swarm delivery happens asynchronously in processOutbox, so callers never
 * block on transport.
 *
 * @param {{
 *   type: string,
 *   payload?: any,
 *   targets?: string[]
 * }} action - When `targets` is provided, only those device IDs are
 *   addressed (self always excluded). Otherwise every paired peer is.
 * @returns {Promise<{
 *   results: Array<{ targetDeviceId: string, channel: 'outbox' }>,
 *   failures: Array<{ targetDeviceId: string, error: Error }>
 * }>}
 */
export const broadcastAction = async ({ type, payload, targets } = {}) => {
  if (!type) {
    throw new Error('broadcastAction: type is required')
  }

  if (!Object.values(ACTION_TYPES).includes(type)) {
    throw new Error('broadcastAction: unknown action type: ' + type)
  }

  const myDeviceId = await getMyDeviceId()
  if (!myDeviceId) {
    throw new Error('broadcastAction: cannot resolve own device id')
  }

  const devices = (await listDevices()) ?? []
  const targetSet = Array.isArray(targets) ? new Set(targets) : null
  const others = devices.filter(
    (d) =>
      d?.id &&
      d.id !== myDeviceId &&
      (targetSet === null || targetSet.has(d.id))
  )

  const results = []
  const failures = []

  for (const target of others) {
    // Per-target id, frozen at append time so signed retries match and the
    // receiver can dedupe replays on (actor, id).
    const envelopeBase = {
      id: generateUniqueId(),
      type,
      payload,
      actor: myDeviceId,
      sentAt: new Date().toISOString()
    }
    try {
      await outboxAppend({
        targetDeviceId: target.id,
        targetTopic: target.masterTopic ?? null,
        envelopeBase
      })
      results.push({ targetDeviceId: target.id, channel: 'outbox' })
    } catch (error) {
      failures.push({ targetDeviceId: target.id, error })
    }
  }

  if (results.length) {
    import('./actionRunner')
      .then(({ runActionScan }) => runActionScan())
      .catch(() => {})
  }

  if (failures.length) {
    logger.error('broadcastAction: partial failures', { type, failures })
  }

  return { results, failures }
}

/**
 * Sign and wrap an envelope base for transport. The wrapper is hex JSON:
 *   { envelope: <hex of body JSON>, signature: <hex of ed25519 detached sig> }
 * The body bytes are hex-encoded so receiver verifies against the exact bytes
 * the sender hashed (no JSON canonicalisation surprises).
 *
 * @param {Object} envelopeBase
 * @returns {Promise<string>} hex of wrapper JSON
 */
export const encodeEnvelope = async (envelopeBase) => {
  const json = JSON.stringify(envelopeBase)
  const bodyHex = Buffer.from(json, 'utf8').toString('hex')
  const signature = await pearpassVaultClient.signMessage(bodyHex)
  const wrapperJson = JSON.stringify({ envelope: bodyHex, signature })
  return Buffer.from(wrapperJson, 'utf8').toString('hex')
}

/**
 * @param {string} wrapperHex
 * @param {{ verify?: boolean }} [opts] - when true, verify the signature
 *   against the actor's masterTopic from the peer registry. Default true.
 * @returns {Promise<Object | null>}
 */
export const decodeEnvelope = async (wrapperHex, opts = { verify: true }) => {
  try {
    const wrapperJson = Buffer.from(wrapperHex, 'hex').toString('utf8')
    const wrapper = JSON.parse(wrapperJson)
    const bodyHex = wrapper?.envelope
    const signatureHex = wrapper?.signature
    if (!bodyHex || !signatureHex) return null

    const bodyJson = Buffer.from(bodyHex, 'hex').toString('utf8')
    const body = JSON.parse(bodyJson)

    if (opts?.verify !== false) {
      const { lookupPeerMasterTopic } = await import('./inbox')
      const publicKey = await lookupPeerMasterTopic(body?.actor)
      if (!publicKey) {
        logger.error('broadcastAction: actor unknown', { actor: body?.actor })
        return null
      }
      const ok = await pearpassVaultClient.verifySignature(
        bodyHex,
        signatureHex,
        publicKey
      )
      if (!ok) {
        logger.error('broadcastAction: signature invalid', {
          actor: body?.actor
        })
        return null
      }
    }

    return body
  } catch (err) {
    logger.error('broadcastAction: failed to decode envelope', { err })
    return null
  }
}
