import { generateUniqueId } from 'lockwright-utils-generate-unique-id'

import { ACTIONS } from '../actions'
import { pearpassVaultClient } from '../instances'
import { decodeEnvelope } from './broadcastAction'
import { listDevices } from './listDevices'
import { getMyDeviceId } from '../utils/getMyDeviceId'
import { logger } from '../utils/logger'

const INBOX_PREFIX = 'actions/inbox/'
const SEEN_PREFIX = 'actions/seen/'
const SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * @param {{ envelope: string }} message
 * @returns {Promise<void>}
 */
export const acceptInboundEnvelope = async ({ envelope } = {}) => {
  if (!envelope) return

  const decoded = await decodeEnvelope(envelope, { verify: true })
  if (!decoded || !decoded.type) {
    logger.error('inbox: dropped malformed or unsigned envelope')
    return
  }

  const myDeviceId = await getMyDeviceId().catch(() => null)
  if (myDeviceId && decoded.actor === myDeviceId) {
    return
  }

  if (await isSeen(decoded.actor, decoded.id)) {
    return
  }

  const id = generateUniqueId()
  const ts = Date.now()
  // Pad to a fixed width so lexicographic iteration matches arrival order
  // even for envelopes that land in the same ms. 13 digits covers Date.now()
  // through year 2286.
  const key = `${INBOX_PREFIX}${String(ts).padStart(13, '0')}_${id}`
  const record = { id, receivedAt: ts, envelope: decoded }

  try {
    await pearpassVaultClient.vaultsAdd(key, record)
    await markSeen(decoded.actor, decoded.id)
  } catch (err) {
    logger.error('inbox: failed to persist envelope', { err })
  }
}

const seenKey = (actor, envelopeId) => `${SEEN_PREFIX}${actor}/${envelopeId}`

const isSeen = async (actor, envelopeId) => {
  if (!actor || !envelopeId) return false
  try {
    const entry = await pearpassVaultClient?.vaultsGet?.(
      seenKey(actor, envelopeId)
    )
    return !!entry
  } catch {
    return false
  }
}

const markSeen = async (actor, envelopeId) => {
  if (!actor || !envelopeId) return
  try {
    await pearpassVaultClient.vaultsAdd(seenKey(actor, envelopeId), {
      seenAt: Date.now()
    })
  } catch (err) {
    logger.error('inbox: failed to mark seen', { err })
  }
}

const INBOX_MAX_ATTEMPTS = 5
const INBOX_QUARANTINE_PREFIX = 'actions/inbox-quarantine/'

/**
 * @returns {Promise<{ processed: number, skipped: number, deferred: number, failed: number, quarantined: number }>}
 */
export const processInbox = async () => {
  if (typeof pearpassVaultClient?.vaultsFind !== 'function') {
    return { processed: 0, skipped: 0, deferred: 0, failed: 0, quarantined: 0 }
  }

  let entries
  try {
    entries =
      (await pearpassVaultClient.vaultsFind({
        gte: { key: INBOX_PREFIX },
        lt: { key: nextPrefix(INBOX_PREFIX) }
      })) ?? []
  } catch (err) {
    if (/not initialised/i.test(err?.message ?? '')) {
      return {
        processed: 0,
        skipped: 0,
        deferred: 0,
        failed: 0,
        quarantined: 0
      }
    }
    throw err
  }

  let processed = 0
  let skipped = 0
  let deferred = 0
  let failed = 0
  let quarantined = 0

  for (const entry of entries) {
    const record = entry?.value
    const envelope = record?.envelope
    const handler = envelope ? ACTIONS[envelope.type] : null
    if (!handler) {
      skipped += 1
      continue
    }

    try {
      const result = await handler.execute(envelope)
      if (result?.status === 'deferred') {
        deferred += 1
        continue
      }
      await pearpassVaultClient.vaultsRemove(entry.key)
      processed += 1
    } catch (err) {
      const attempts = (record.attempts ?? 0) + 1
      logger.error('inbox: handler threw', {
        err,
        type: envelope?.type,
        attempts
      })
      if (attempts >= INBOX_MAX_ATTEMPTS) {
        await quarantineEntry(entry.key, record, err)
        quarantined += 1
      } else {
        await pearpassVaultClient.vaultsAdd(entry.key, {
          ...record,
          attempts,
          lastError: err?.message ?? String(err)
        })
        failed += 1
      }
    }
  }

  await pruneSeen()

  return { processed, skipped, deferred, failed, quarantined }
}

const pruneSeen = async () => {
  if (typeof pearpassVaultClient?.vaultsFind !== 'function') return
  let entries
  try {
    entries =
      (await pearpassVaultClient.vaultsFind({
        gte: { key: SEEN_PREFIX },
        lt: { key: nextPrefix(SEEN_PREFIX) }
      })) ?? []
  } catch {
    return
  }
  const cutoff = Date.now() - SEEN_TTL_MS
  for (const entry of entries) {
    if ((entry?.value?.seenAt ?? 0) < cutoff) {
      await pearpassVaultClient.vaultsRemove(entry.key).catch(() => {})
    }
  }
}

const quarantineEntry = async (key, record, err) => {
  const suffix = key.slice(INBOX_PREFIX.length)
  const quarantineKey = `${INBOX_QUARANTINE_PREFIX}${suffix}`
  try {
    await pearpassVaultClient.vaultsAdd(quarantineKey, {
      ...record,
      quarantinedAt: Date.now(),
      lastError: err?.message ?? String(err)
    })
    await pearpassVaultClient.vaultsRemove(key)
  } catch (e) {
    logger.error('inbox: quarantine failed', { e })
  }
}

const nextPrefix = (prefix) => {
  const last = prefix.charCodeAt(prefix.length - 1)
  return prefix.slice(0, -1) + String.fromCharCode(last + 1)
}

export const lookupPeerMasterTopic = async (actor) => {
  if (!actor) return null
  try {
    const peer = await pearpassVaultClient?.vaultsGet?.(`peer/${actor}`)
    if (peer?.masterTopic) return peer.masterTopic
    const myDevices = (await listDevices()) ?? []
    return myDevices.find((d) => d?.id === actor)?.masterTopic ?? null
  } catch (err) {
    logger.error('inbox: lookup peer masterTopic failed', { err })
    return null
  }
}

export const PEER_PREFIX = 'peer/'

export const registerPeer = async (device) => {
  if (!device?.id) return
  try {
    await pearpassVaultClient?.vaultsAdd?.(`${PEER_PREFIX}${device.id}`, {
      id: device.id,
      name: device.name ?? null,
      writerKey: device.writerKey ?? null,
      masterTopic: device.masterTopic ?? null,
      lastSeenAt: Date.now()
    })
  } catch (err) {
    logger.error('inbox: registerPeer failed', { err })
  }
}

export {
  INBOX_PREFIX,
  INBOX_QUARANTINE_PREFIX,
  INBOX_MAX_ATTEMPTS,
  SEEN_PREFIX
}
