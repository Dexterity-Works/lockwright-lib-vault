import { setPearpassVaultClient } from './src/instances'

// Polyfill TextEncoder/TextDecoder for jsdom environment
const util = require('util')

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = util.TextEncoder
  globalThis.TextDecoder = util.TextDecoder
}

const mockClient = {
  activeVaultGetStatus: jest.fn(),
  activeVaultClose: jest.fn(),
  vaultsGetStatus: jest.fn(),
  vaultsClose: jest.fn(),
  encryptionGetStatus: jest.fn(),
  encryptionClose: jest.fn(),
  activeVaultCreateInvite: jest.fn(),
  activeVaultDeleteInvite: jest.fn(),
  activeVaultAdd: jest.fn(),
  vaultsAdd: jest.fn(),
  removeVault: jest.fn(),
  activeVaultInit: jest.fn(),
  activeVaultRemove: jest.fn(),
  activeVaultRemoveWriter: jest.fn(),
  activeVaultEnsureEpoch: jest.fn(),
  activeVaultGetEpochStatus: jest.fn(),
  encryptionInit: jest.fn(),
  encryptionGet: jest.fn(),
  activeVaultGet: jest.fn(),
  vaultsInit: jest.fn(),
  initListener: jest.fn(),
  on: jest.fn(),
  removeAllListeners: jest.fn(),
  activeVaultList: jest.fn(),
  vaultsList: jest.fn(),
  pairActiveVault: jest.fn(),
  cancelPairActiveVault: jest.fn(),
  setStoragePath: jest.fn(),
  encryptionAdd: jest.fn(),
  generateHotpNext: jest.fn(),
  generateOtpCodesByIds: jest.fn(),
  activeVaultFind: jest.fn(),
  activeVaultGetWriterKey: jest.fn().mockResolvedValue('writer-key-hex'),
  vaultsGet: jest.fn(),
  vaultsRemove: jest.fn(),
  vaultsFind: jest.fn(),
  decryptProtonExport: jest.fn(),
  decryptAegisExport: jest.fn(),
  signMessage: jest.fn(),
  verifySignature: jest.fn(),
  personalSwarmInit: jest.fn(),
  personalSwarmClose: jest.fn(),
  personalSwarmGetTopic: jest.fn(),
  personalSwarmSend: jest.fn(),
  emit: jest.fn(),
  off: jest.fn(),
  listenerCount: jest.fn().mockReturnValue(0)
}

setPearpassVaultClient(mockClient, { currentDeviceName: null })

global.pearpassVaultClient = mockClient

afterEach(() => {
  jest.clearAllMocks()
})
