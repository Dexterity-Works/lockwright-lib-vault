export { RECORD_TYPES } from './constants/recordTypes'
export { OTP_TYPE } from './constants/otpType'

export { useCreateFolder } from './hooks/useCreateFolder'
export { useCreateRecord } from './hooks/useCreateRecord'
export { useCreateVault } from './hooks/useCreateVault'
export { useFavicon } from './hooks/useFavicon'
export { useFolders } from './hooks/useFolders'
export { useInvite } from './hooks/useInvite.js'
export { usePair } from './hooks/usePair'
export { useRecordById } from './hooks/useRecordById'
export { useRecordCountsByType } from './hooks/useRecordCountsByType'
export { useRecords } from './hooks/useRecords'
export { useUserData } from './hooks/useUserData'
export { useVault } from './hooks/useVault'
export { useVaults } from './hooks/useVaults'
export { useBlindMirrors } from './hooks/useBlindMirrors'
export { VaultProvider } from './store'

export { closeAllInstances } from './api/closeAllInstances'
export {
  setPearpassVaultClient,
  setCurrentDeviceName,
  setStoragePath
} from './instances'

export { broadcastAction } from './api/broadcastAction'
export { broadcastDeleteVault } from './api/broadcastDeleteVault'
export { VaultNotActiveError } from './api/deleteVaultLocal'
export { EPOCH_FAILURE_KIND, kickDevice } from './api/kickDevice'
export { runActionScan } from './api/actionRunner'
export { getMyDeviceId } from './utils/getMyDeviceId'

export { ACTION_TYPES, ACTIONS } from './actions'

export {
  SCHEMA_V2,
  DEFAULT_URI_MATCH,
  RECORD_V1_PREFIX,
  RECORD_V2_PREFIX,
  VAULT_EXT_KEY,
  recordKeyV1,
  recordKeyV2,
  fileKeyV1,
  fileKeyV2,
  projectRecordToV1,
  toAppRecord,
  isMatchOnlyChange,
  deriveWebsitesFromUris,
  deriveUrisFromWebsites
} from './compat'

export { setBlockV1DeleteMirror } from './api/setBlockV1DeleteMirror'
export { emitSchemaMigrationWarning } from './api/emitSchemaMigrationWarning'

export { authoriseCurrentProtectedVault } from './api/authoriseCurrentProtectedVault'
export { getVaultById } from './api/getVaultById'
export { getCurrentProtectedVaultEncryption } from './api/getCurrentProtectedVaultEncryption'
export { listRecords } from './api/listRecords'
export { vaultGetFile } from './api/getFile.js'
export { getCanonicalRecord } from './api/getCanonicalRecord.js'
export { getMasterEncryption } from './api/getMasterEncryption.js'
export { getDefaultFavicon } from './api/getDefaultFavicon.js'
export { encryptExportData } from './api/encryptExportData.js'
export { decryptExportData } from './api/decryptExportData.js'
export { decryptProtonExport } from './api/decryptProtonExport.js'
export { decryptAegisExport } from './api/decryptAegisExport.js'
export { generateOtpCodesByIds } from './api/generateOtpCodesByIds.js'
export { generateHotpNext } from './api/generateHotpNext.js'

export { useOtp } from './hooks/useOtp'
export { OtpRefreshProvider } from './context/OtpRefreshProvider'
export { useOtpRefresh } from './hooks/useOtpRefresh'
export { useOtpWatch } from './hooks/useOtpWatch'
export { useTimerAnimation } from './hooks/useTimerAnimation'

export { formatOtpCode } from './utils/formatOtpCode'
export { createAlignedInterval } from './utils/createAlignedInterval'
export { isExpiring, EXPIRY_THRESHOLD_SECONDS } from './utils/otpExpiry'
export { groupOtpRecords } from './utils/groupOtpRecords'
export { matchLoginRecords } from './utils/matchLoginRecords'
export { validateOtpInput } from './utils/validateOtpInput'
export { parseOtpInput } from './utils/parseOtpInput'

export { findOtpDuplicates } from './api/findOtpDuplicates'
export { useFindOtpDuplicates } from './hooks/useFindOtpDuplicates'
export { exportOtpRecords } from './api/exportOtpRecords'
