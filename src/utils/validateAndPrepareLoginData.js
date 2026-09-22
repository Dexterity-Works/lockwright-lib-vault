import { Validator } from 'lockwright-utils-validator'

import { parseOtpInput } from './parseOtpInput'
import {
  customFieldSchema,
  validateAndPrepareCustomFields
} from './validateAndPrepareCustomFields'
import {
  DEFAULT_URI_MATCH,
  deriveUrisFromWebsites,
  deriveWebsitesFromUris
} from '../compat/recordSchema'
import { fileSchema } from '../schemas/fileSchema'

export const otpSchema = Validator.object({
  secret: Validator.string().required(),
  type: Validator.string().required(),
  algorithm: Validator.string().required(),
  digits: Validator.number().required(),
  period: Validator.number(),
  counter: Validator.number(),
  issuer: Validator.string(),
  label: Validator.string()
})

export const credentialSchema = Validator.object({
  authenticatorAttachment: Validator.string().required(),
  clientExtensionResults: Validator.object({
    credProps: Validator.object({
      rk: Validator.boolean().required()
    })
  }).required(),
  id: Validator.string().required(),
  rawId: Validator.string().required(),
  response: Validator.object({
    attestationObject: Validator.string().required(),
    authenticatorData: Validator.string().required(),
    clientDataJSON: Validator.string().required(),
    publicKey: Validator.string().required(),
    publicKeyAlgorithm: Validator.number().required(),
    transports: Validator.array().items(Validator.string()).required()
  }).required(),
  type: Validator.string().required(),
  _privateKeyBuffer: Validator.string().required(),
  _userId: Validator.string().required()
})

export const uriEntrySchema = Validator.object({
  uri: Validator.string().required(),
  match: Validator.string()
})

export const loginSchema = Validator.object({
  title: Validator.string().required(),
  username: Validator.string(),
  password: Validator.string(),
  passwordUpdatedAt: Validator.number(),
  passkeyCreatedAt: Validator.number(),
  credential: credentialSchema,
  note: Validator.string(),
  websites: Validator.array().items(Validator.string().required()),
  uris: Validator.array().items(uriEntrySchema),
  customFields: Validator.array().items(customFieldSchema),
  attachments: Validator.array().items(fileSchema),
  otp: otpSchema,
  otpInput: Validator.string()
})

export const validateAndPrepareLoginData = (login) => {
  const otp = login.otpInput ? parseOtpInput(login.otpInput) : login.otp

  let uris = login.uris
  let websites = login.websites

  if (Array.isArray(uris)) {
    uris = uris.map((entry) => ({
      uri: entry.uri,
      match:
        typeof entry.match === 'string' && entry.match.length > 0
          ? entry.match
          : DEFAULT_URI_MATCH
    }))
    websites = deriveWebsitesFromUris(
      uris,
      Array.isArray(websites) ? websites : undefined
    )
  } else if (Array.isArray(websites)) {
    uris = deriveUrisFromWebsites(websites, login.uris)
  }

  const loginData = {
    title: login.title,
    username: login.username,
    password: login.password,
    passkeyCreatedAt: login.passkeyCreatedAt,
    passwordUpdatedAt: login.passwordUpdatedAt,
    credential: login.credential,
    note: login.note,
    websites,
    uris,
    customFields: validateAndPrepareCustomFields(login.customFields),
    attachments: login.attachments,
    otp,
    otpInput: login.otpInput
  }

  const errors = loginSchema.validate(loginData)

  if (errors) {
    throw new Error(`Invalid login data: ${JSON.stringify(errors, null, 2)}`)
  }

  return loginData
}
