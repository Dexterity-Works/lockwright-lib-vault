import { generateUniqueId } from 'lockwright-utils-generate-unique-id'

import { validateAndPrepareDevice } from './validateAndPrepareDevice'
import { SCHEMA_V2 } from '../compat/recordSchema'

/**
 * @param {string} deviceName - device name (e.g. `Platform.OS + ' ' + Platform.Version`)
 * @param {string} vaultId
 * @param {string} writerKey - the autobase writer key for this device on this vault
 * @param {string} [masterTopic] - hex-encoded personal swarm topic for this device
 * @returns {Object}
 */
export const addDeviceFactory = (
  deviceName,
  vaultId,
  writerKey,
  masterTopic
) => {
  if (!deviceName || !vaultId || !writerKey) {
    throw new Error('deviceName, vaultId and writerKey are required')
  }

  const device = {
    id: generateUniqueId(),
    vaultId: vaultId,
    name: deviceName,
    writerKey,
    createdAt: Date.now(),
    recordSchema: SCHEMA_V2
  }
  if (masterTopic) device.masterTopic = masterTopic

  return validateAndPrepareDevice(device)
}
