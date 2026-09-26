/**
 * Minimal Validator stub for local jest runs when the real package
 * is not linked. Mirrors the subset used by pearpass-lib-vault.
 */

const isEmpty = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '')

const makeNode = (checks = []) => {
  const node = {
    required() {
      return makeNode([...checks, { type: 'required' }])
    },
    email() {
      return makeNode([...checks, { type: 'email' }])
    },
    items(itemSchema) {
      return makeNode([...checks, { type: 'items', itemSchema }])
    },
    validate(value) {
      return runChecks(value, checks)
    }
  }
  return node
}

const runChecks = (value, checks) => {
  for (const check of checks) {
    if (check.type === 'required' && isEmpty(value)) {
      return { required: true }
    }
    if (check.type === 'string') {
      if (value !== null && value !== undefined && typeof value !== 'string') {
        return { type: 'string' }
      }
    }
    if (check.type === 'email') {
      if (
        value !== null &&
        value !== undefined &&
        typeof value === 'string' &&
        value.length > 0 &&
        !value.includes('@')
      ) {
        return { type: 'email' }
      }
    }
    if (check.type === 'number') {
      if (value !== null && value !== undefined && typeof value !== 'number') {
        return { type: 'number' }
      }
    }
    if (check.type === 'boolean') {
      if (value !== null && value !== undefined && typeof value !== 'boolean') {
        return { type: 'boolean' }
      }
    }
    if (check.type === 'array') {
      if (value !== null && value !== undefined && !Array.isArray(value)) {
        return { type: 'array' }
      }
    }
    if (check.type === 'items' && check.itemSchema && Array.isArray(value)) {
      for (const item of value) {
        const err = check.itemSchema.validate(item)
        if (err) return err
      }
    }
    if (check.type === 'object') {
      if (value !== null && value !== undefined) {
        if (typeof value !== 'object' || Array.isArray(value)) {
          return { type: 'object' }
        }
        for (const [key, schema] of Object.entries(check.shape)) {
          if (!schema || typeof schema.validate !== 'function') {
            return { [key]: 'invalid-schema' }
          }
          const err = schema.validate(value[key])
          if (err) return { [key]: err }
        }
      }
    }
  }
  return null
}

export const Validator = {
  string: () => makeNode([{ type: 'string' }]),
  number: () => makeNode([{ type: 'number' }]),
  boolean: () => makeNode([{ type: 'boolean' }]),
  array: () => makeNode([{ type: 'array' }]),
  object: (shape = {}) => makeNode([{ type: 'object', shape }])
}
