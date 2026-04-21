import type Database from 'better-sqlite3'
import { getDb } from './db'
import {
  getSetting as _getSetting,
  setSetting as _setSetting,
  deleteSetting as _deleteSetting,
  getSettingJson as _getSettingJson,
  setSettingJson as _setSettingJson
} from './data/settings-queries'
import {
  SENSITIVE_SETTING_KEYS,
  ENCRYPTED_PREFIX,
  encryptSetting,
  decryptSetting
} from './secure-storage'
import { createLogger } from './logger'

const logger = createLogger('settings')

export function getSetting(key: string, db?: Database.Database): string | null {
  const raw = _getSetting(db ?? getDb(), key)
  if (raw === null) return null
  if (SENSITIVE_SETTING_KEYS.has(key)) {
    const plaintext = decryptSetting(raw)
    // Lazy migration: re-encrypt any legacy plaintext values found in the DB.
    // Skip silently if encryption is unavailable — we cannot upgrade now.
    if (!raw.startsWith(ENCRYPTED_PREFIX)) {
      try {
        _setSetting(db ?? getDb(), key, encryptSetting(plaintext))
      } catch (err) {
        logger.warn(
          `Skipping lazy re-encryption of "${key}": ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
    return plaintext
  }
  return raw
}

export function setSetting(key: string, value: string, db?: Database.Database): void {
  const stored = SENSITIVE_SETTING_KEYS.has(key) ? encryptSetting(value) : value
  _setSetting(db ?? getDb(), key, stored)
}

export function deleteSetting(key: string, db?: Database.Database): void {
  _deleteSetting(db ?? getDb(), key)
}

export function getSettingJson<T>(key: string, db?: Database.Database): T | null {
  return _getSettingJson<T>(db ?? getDb(), key)
}

export function setSettingJson<T>(key: string, value: T, db?: Database.Database): void {
  _setSettingJson<T>(db ?? getDb(), key, value)
}

// Well-known setting keys
export const SETTING_DEPENDENCY_CASCADE_BEHAVIOR = 'dependency.cascadeBehavior'
export const SETTING_MCP_ENABLED = 'mcp.enabled'
export const SETTING_MCP_PORT = 'mcp.port'
export { MCP_DEFAULT_PORT } from '../shared/mcp-constants'
import { MCP_DEFAULT_PORT } from '../shared/mcp-constants'

export function getMcpEnabled(): boolean {
  return getSetting(SETTING_MCP_ENABLED) === 'true'
}

export function getMcpPort(): number {
  const raw = getSetting(SETTING_MCP_PORT)
  if (!raw) return MCP_DEFAULT_PORT
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : MCP_DEFAULT_PORT
}
