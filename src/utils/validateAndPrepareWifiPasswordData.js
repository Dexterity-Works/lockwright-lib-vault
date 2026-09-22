import { Validator } from 'lockwright-utils-validator'

import {
  customFieldSchema,
  validateAndPrepareCustomFields
} from './validateAndPrepareCustomFields'
import { fileSchema } from '../schemas/fileSchema'

export const wifiPasswordSchema = Validator.object({
  title: Validator.string().required(),
  password: Validator.string().required(),
  note: Validator.string(),
  customFields: Validator.array().items(customFieldSchema),
  attachments: Validator.array().items(fileSchema)
})

export const validateAndPrepareWifiPasswordData = (wifiPassword) => {
  const wifiPasswordData = {
    title: wifiPassword.title,
    password: wifiPassword.password,
    note: wifiPassword.note,
    customFields: validateAndPrepareCustomFields(wifiPassword.customFields),
    attachments: wifiPassword.attachments
  }

  const errors = wifiPasswordSchema.validate(wifiPasswordData)

  if (errors) {
    throw new Error(
      `Invalid wifi password data: ${JSON.stringify(errors, null, 2)}`
    )
  }

  return wifiPasswordData
}
