import { Validator } from 'lockwright-utils-validator'

import {
  customFieldSchema,
  validateAndPrepareCustomFields
} from './validateAndPrepareCustomFields'
import { fileSchema } from '../schemas/fileSchema'

export const passPhraseSchema = Validator.object({
  title: Validator.string().required(),
  passPhrase: Validator.string().required(),
  note: Validator.string(),
  customFields: Validator.array().items(customFieldSchema),
  attachments: Validator.array().items(fileSchema)
})

export const validateAndPreparePassPhraseData = (passPhrase) => {
  const passPhraseData = {
    title: passPhrase.title,
    passPhrase: passPhrase.passPhrase,
    note: passPhrase.note,
    customFields: validateAndPrepareCustomFields(passPhrase.customFields),
    attachments: passPhrase.attachments
  }

  const errors = passPhraseSchema.validate(passPhraseData)

  if (errors) {
    throw new Error(
      `Invalid pass phrase data: ${JSON.stringify(errors, null, 2)}`
    )
  }

  return passPhraseData
}
