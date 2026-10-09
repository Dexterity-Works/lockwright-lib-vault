import { Validator } from 'lockwright-lib-utils/validator'

export const fileSchema = Validator.object({
  id: Validator.string().required(),
  name: Validator.string().required()
})
