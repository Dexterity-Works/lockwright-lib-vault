export interface OtpPublic {
  type: 'TOTP' | 'HOTP'
  digits: number
  period?: number
  issuer?: string
  label?: string
  currentCode: string | null
  timeRemaining?: number | null
}

export interface OtpGroupResult {
  totpGroups: Array<{ period: number; records: Array<unknown> }>
  hotpRecords: Array<unknown>
}

export declare function groupOtpRecords(
  _records: Array<{ otpPublic?: OtpPublic }>
): OtpGroupResult

export declare const ACTION_TYPES: {
  DELETE_VAULT: 'delete-vault'
  LEAVE_VAULT: 'leave-vault'
  KICK_DEVICE: 'kick-device'
} & Record<string, string>

export declare const ACTIONS: Record<
  string,
  { execute: (_entry: unknown) => Promise<void> }
>

export interface BroadcastActionResult {
  results: Array<{ targetDeviceId: string; channel: 'outbox' }>
  failures: Array<{ targetDeviceId: string; error: Error }>
}

export declare function broadcastAction(_action: {
  type: string
  payload?: any
}): Promise<BroadcastActionResult>

export declare function broadcastDeleteVault(
  _vaultId: string
): Promise<BroadcastActionResult>

export declare class VaultNotActiveError extends Error {
  name: 'VaultNotActiveError'
  vaultId: string
  constructor(_vaultId: string)
}

export declare function deleteVaultLocal(
  _vaultId: string
): Promise<Array<unknown>>

export declare function runActionScan(): Promise<void>

export declare function getMyDeviceId(): Promise<string | null>

export interface EnsureEpochResult {
  rotated: boolean
  id?: string
  seq?: number
  members?: string[]
  reason?:
    | 'current'
    | 'pending'
    | 'legacy'
    | 'not-writable'
    | 'self-not-in-roster'
  uncovered: string[]
}

export interface EpochStatus {
  vaultId: string
  epoch: string | null
  seq: number
  legacy: boolean
  canRead: boolean
  revoked: boolean
  members: string[]
  uncovered: string[]
}

export interface PearpassVaultEpochClient {
  activeVaultEnsureEpoch(_options: {
    start: boolean
  }): Promise<EnsureEpochResult>
  activeVaultGetEpochStatus(): Promise<EpochStatus>
}

export interface VaultKeyState {
  vaultId: string
  epoch: string | null
  legacy: boolean
  canRead: boolean
  members: string[]
  rotatedAt: number | null
  removed: Array<{ id: string; name: string | null }>
}

export declare function getVaultKeyState(): Promise<VaultKeyState | null>

export declare function waitForKeyRotation(_params: {
  vaultId: string
  deviceId: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<VaultKeyState | null>

export declare const EPOCH_FAILURE_KIND: 'epoch'

export interface KickDeviceResult extends BroadcastActionResult {
  failures: Array<{
    targetDeviceId: string
    error: Error
    kind?: typeof EPOCH_FAILURE_KIND
  }>
  epoch: EnsureEpochResult | null
}

export declare function kickDevice(_params: {
  vaultId: string
  targetDeviceId: string
}): Promise<KickDeviceResult>
