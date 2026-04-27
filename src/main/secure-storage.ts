import { safeStorage } from 'electron'
import { createLogger } from './logger'

const logger = createLogger('secure-storage')

export const ENCRYPTED_PREFIX = 'ENC:'

export const SENSITIVE_SETTING_KEYS: ReadonlySet<string> = new Set(['github.token'])

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function encryptSetting(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Cannot store sensitive setting: safeStorage encryption is unavailable. ' +
        'Unlock your system keychain or run FLEET in a supported environment.'
    )
  }
  const encrypted = safeStorage.encryptString(value)
  return ENCRYPTED_PREFIX + encrypted.toString('base64')
}

/**
 * Decrypts a setting value that was previously encrypted with `encryptSetting`.
 *
 * Returns the original plaintext when decryption succeeds, or the raw value
 * as-is when the stored string has no ENC: prefix (legacy unencrypted rows).
 *
 * Returns `undefined` when decryption fails — the caller must treat the
 * setting as unreadable rather than propagating the raw encrypted blob as
 * if it were plaintext.
 */
export function decryptSetting(stored: string): string | undefined {
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    return stored
  }
  const encoded = stored.slice(ENCRYPTED_PREFIX.length)
  const buffer = Buffer.from(encoded, 'base64')
  try {
    return safeStorage.decryptString(buffer)
  } catch (err) {
    logger.error(
      `[secure-storage] Failed to decrypt setting — discarding encrypted blob: ${err instanceof Error ? err.message : String(err)}`
    )
    return undefined
  }
}
