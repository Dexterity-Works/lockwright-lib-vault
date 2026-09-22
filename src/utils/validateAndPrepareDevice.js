import { Validator } from 'lockwright-utils-validator'

import { logger } from './logger'

export const deviceSchema = Validator.object({
  id: Validator.string().required(),
  vaultId: Validator.string().required(),
  name: Validator.string().required(),
  writerKey: Validator.string(),
  masterTopic: Validator.string(),
  createdAt: Validator.number().required(),
  recordSchema: Validator.number()
})

/**
 * Validate required device fields without stripping unknown properties
 * (e.g. recordSchema, feature flags written by newer clients).
 * @param {object} device
 * @returns {object}
 */
export const validateAndPrepareDevice = (device) => {
  if (!device || typeof device !== 'object') {
    logger.error('Invalid device data: Device must be an object')
    throw new Error('Invalid device data: Device must be an object')
  }

  // Validate a known subset so extra fields never fail schema checks.
  const errors = deviceSchema.validate({
    id: device.id,
    vaultId: device.vaultId,
    name: device.name,
    writerKey: device.writerKey,
    masterTopic: device.masterTopic,
    createdAt: device.createdAt,
    recordSchema: device.recordSchema
  })

  if (errors) {
    logger.error(`Invalid device data: ${JSON.stringify(errors, null, 2)}`)

    throw new Error(`Invalid device data: ${JSON.stringify(errors, null, 2)}`)
  }

  // Preserve recordSchema and any unknown fields from the input document.
  return { ...device }
}
