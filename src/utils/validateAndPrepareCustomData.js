import { Validator } from 'lockwright-utils-validator'

import {
  customFieldSchema,
  validateAndPrepareCustomFields
} from './validateAndPrepareCustomFields'
import { fileSchema } from '../schemas/fileSchema'

export const customSchema = Validator.object({
  title: Validator.string().required(),
  customFields: Validator.array().items(customFieldSchema),
  attachments: Validator.array().items(fileSchema),
  note: Validator.string()
})

export const validateAndPrepareCustomData = (custom) => {
  const customData = {
    title: custom.title,
    customFields: validateAndPrepareCustomFields(custom.customFields),
    attachments: custom.attachments,
    note: custom.note
  }

  const errors = customSchema.validate(customData)

  if (errors) {
    throw new Error(`Invalid custom data: ${JSON.stringify(errors, null, 2)}`)
  }

  return customData
}
