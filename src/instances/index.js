export let pearpassVaultClient

let currentDeviceNameValue = null
let envelopeSubscription = null
let newListenerSubscription = null
let masterUpdateSubscription = null
let epochStatusSubscription = null
const epochRevokedVaultIds = new Set()

/**
 * @param {object} instance
 * @param {{ currentDeviceName: string }} options
 */
export const setPearpassVaultClient = (
  instance,
  { currentDeviceName } = {}
) => {
  detachEnvelopeListener()
  detachNewListenerHook()
  detachMasterUpdateHook()
  detachEpochStatusHook()
  epochRevokedVaultIds.clear()

  pearpassVaultClient = instance
  currentDeviceNameValue = currentDeviceName ?? null

  attachEnvelopeListener()
  attachNewListenerHook()
  attachMasterUpdateHook()
  attachEpochStatusHook()
}

/**
 * @param {string | null} name
 */
export const setCurrentDeviceName = (name) => {
  currentDeviceNameValue = name ?? null
}

/**
 * @returns {string | null}
 */
export const getCurrentDeviceName = () => currentDeviceNameValue

/**
 * @param {string} path
 */
export const setStoragePath = async (path) => {
  await pearpassVaultClient.setStoragePath(path)
}

// Dynamic imports avoid a load-time cycle (inbox + actionRunner read
// pearpassVaultClient from this module).
const attachEnvelopeListener = () => {
  if (!pearpassVaultClient?.on) return
  if (envelopeSubscription) return

  envelopeSubscription = async (message) => {
    try {
      const { acceptInboundEnvelope } = await import('../api/inbox.js')
      await acceptInboundEnvelope(message)
      const { runActionScan } = await import('../api/actionRunner.js')
      runActionScan().catch(() => {})
    } catch {}
  }
  pearpassVaultClient.on('personal-swarm-envelope', envelopeSubscription)
}

const detachEnvelopeListener = () => {
  const sub = envelopeSubscription
  envelopeSubscription = null
  if (sub && pearpassVaultClient?.off) {
    pearpassVaultClient.off('personal-swarm-envelope', sub)
  }
}

// Re-run processInbox when a consumer subscribes to an event our handlers
// emit, so envelopes that arrived before the listener mounted can still be
// delivered. Re-check the epoch status for the same reason.
const attachNewListenerHook = () => {
  if (!pearpassVaultClient?.on) return
  if (newListenerSubscription) return

  newListenerSubscription = async (event) => {
    if (event !== 'vault-access-revoked') return
    try {
      const { runActionScan } = await import('../api/actionRunner.js')
      runActionScan().catch(() => {})
    } catch {}
    try {
      const status = await pearpassVaultClient.activeVaultGetEpochStatus?.()
      await handleEpochStatus(status)
    } catch {}
  }
  pearpassVaultClient.on('newListener', newListenerSubscription)
}

const detachNewListenerHook = () => {
  const sub = newListenerSubscription
  newListenerSubscription = null
  if (sub && pearpassVaultClient?.off) {
    pearpassVaultClient.off('newListener', sub)
  }
}

// Drain inbox/outbox whenever the master vault mutates from another process.
// Covers the extension-write -> desktop-process flow: the extension writes an
// outbox entry via the proxied vaultsAdd, the master vault emits 'update',
// and this hook kicks the desktop's runActionScan to deliver the entry.
const attachMasterUpdateHook = () => {
  if (!pearpassVaultClient?.on) return
  if (masterUpdateSubscription) return

  masterUpdateSubscription = async () => {
    try {
      const { runActionScan } = await import('../api/actionRunner.js')
      runActionScan().catch(() => {})
    } catch {}
  }
  pearpassVaultClient.on('master-update', masterUpdateSubscription)
}

const detachMasterUpdateHook = () => {
  const sub = masterUpdateSubscription
  masterUpdateSubscription = null
  if (sub && pearpassVaultClient?.off) {
    pearpassVaultClient.off('master-update', sub)
  }
}

// Surface a revocation by key rotation (this device was left out of the
// latest epoch) through the same event a kick envelope uses, once per vault.
// With no listener yet, record nothing: the newListener hook re-checks.
const handleEpochStatus = async (status) => {
  if (status?.revoked !== true) return
  const vault = await pearpassVaultClient.activeVaultGet(`vault`)
  const vaultId = vault?.id
  if (!vaultId || epochRevokedVaultIds.has(vaultId)) return
  if (!(pearpassVaultClient.listenerCount?.('vault-access-revoked') > 0)) return
  epochRevokedVaultIds.add(vaultId)
  pearpassVaultClient.emit('vault-access-revoked', {
    vaultId,
    actor: null,
    reason: 'epoch'
  })
}

const attachEpochStatusHook = () => {
  if (!pearpassVaultClient?.on) return
  if (epochStatusSubscription) return

  epochStatusSubscription = async (status) => {
    try {
      await handleEpochStatus(status)
    } catch {}
  }
  pearpassVaultClient.on('epoch-status', epochStatusSubscription)
}

const detachEpochStatusHook = () => {
  const sub = epochStatusSubscription
  epochStatusSubscription = null
  if (sub && pearpassVaultClient?.off) {
    pearpassVaultClient.off('epoch-status', sub)
  }
}
