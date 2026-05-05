import { safeStorage } from 'electron'
import { safeHandle } from '../ipc-utils'
import { getSetting, setSetting, getSettingJson, setSettingJson, deleteSetting } from '../settings'
import { SENSITIVE_SETTING_KEYS } from '../secure-storage'
import {
  saveProfile,
  loadProfile,
  applyProfile,
  listProfiles,
  deleteProfile
} from '../services/settings-profiles'
import { validateWorktreeBase } from '../paths'
import { emitSettingChanged } from '../events/settings-events'
import { readOrCreateToken, readRotatedAt, regenerateToken } from '../mcp-server/token-store'

/** Setting keys that require path safety validation before writing. */
const PATH_VALIDATORS: Record<string, (value: string) => void> = {
  'agentManager.worktreeBase': validateWorktreeBase
}

const SET_JSON_VALUE_LIMIT_BYTES = 1_048_576

export function parseSetJsonArgs(args: unknown[]): [string, unknown] {
  const [key, value] = args
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('settings:setJson key must be a non-empty string')
  }
  if (SENSITIVE_SETTING_KEYS.has(key)) {
    throw new Error(`Cannot write sensitive setting "${key}" via settings:setJson`)
  }
  const serialised = JSON.stringify(value)
  if (serialised.length > SET_JSON_VALUE_LIMIT_BYTES) {
    throw new Error(
      `settings:setJson value too large: ${serialised.length} bytes exceeds the ${SET_JSON_VALUE_LIMIT_BYTES}-byte limit`
    )
  }
  return [key, value]
}

const PROFILE_NAME_REGEX = /^[a-zA-Z0-9_-]{1,50}$/

function validateProfileName(name: string): void {
  if (!PROFILE_NAME_REGEX.test(name)) {
    throw new Error(
      `Invalid profile name "${name}". Names must be 1–50 characters using only letters, digits, underscores, or hyphens.`
    )
  }
}

export function registerConfigHandlers(): void {
  // Settings CRUD
  safeHandle('settings:get', (_e, key: string) => {
    // Sensitive keys are never returned to the renderer — use settings:hasSecret instead
    if (SENSITIVE_SETTING_KEYS.has(key)) return null
    return getSetting(key)
  })
  safeHandle('settings:hasSecret', (_e, key: string) => {
    if (!SENSITIVE_SETTING_KEYS.has(key)) return false
    return getSetting(key) !== null
  })
  safeHandle('settings:set', (_e, key: string, value: string) => {
    const validate = PATH_VALIDATORS[key]
    if (validate) validate(value)
    setSetting(key, value)
    emitSettingChanged({ key, value })
  })
  safeHandle('settings:getJson', (_e, key: string) => {
    if (SENSITIVE_SETTING_KEYS.has(key)) return null
    return getSettingJson(key)
  })
  safeHandle('settings:setJson', (_e, key: string, value: unknown) => {
    setSettingJson(key, value)
    emitSettingChanged({ key, value: typeof value === 'string' ? value : JSON.stringify(value) })
  }, parseSetJsonArgs)
  safeHandle('settings:delete', (_e, key: string) => {
    if (SENSITIVE_SETTING_KEYS.has(key)) {
      throw new Error(`Cannot delete sensitive setting "${key}" via this channel`)
    }
    deleteSetting(key)
    emitSettingChanged({ key, value: null })
  })

  // Settings profiles
  safeHandle('settings:saveProfile', (_e, name: string) => {
    validateProfileName(name)
    return saveProfile(name)
  })
  safeHandle('settings:loadProfile', (_e, name: string) => {
    validateProfileName(name)
    return loadProfile(name)
  })
  safeHandle('settings:applyProfile', (_e, name: string) => {
    validateProfileName(name)
    return applyProfile(name)
  })
  safeHandle('settings:listProfiles', () => listProfiles())
  safeHandle('settings:deleteProfile', (_e, name: string) => {
    validateProfileName(name)
    return deleteProfile(name)
  })

  safeHandle('settings:getEncryptionStatus', () => {
    const available = safeStorage.isEncryptionAvailable()
    return {
      available,
      reason: available ? undefined : 'System keychain unavailable'
    }
  })

  safeHandle('mcp:getToken', async () => {
    const { token } = await readOrCreateToken()
    // Mask all but the last 4 chars — caller must use mcp:revealToken for the full value
    const masked = token.length > 4 ? '*'.repeat(token.length - 4) + token.slice(-4) : '****'
    return masked
  })

  safeHandle('mcp:revealToken', async () => {
    const { token } = await readOrCreateToken()
    return token
  })

  safeHandle('mcp:regenerateToken', async () => {
    const { token } = await regenerateToken()
    const enabled = getSetting('mcp.enabled') === 'true'
    if (enabled) {
      setSetting('mcp.enabled', 'false')
      emitSettingChanged({ key: 'mcp.enabled', value: 'false' })
      setSetting('mcp.enabled', 'true')
      emitSettingChanged({ key: 'mcp.enabled', value: 'true' })
    }
    return token
  })

  safeHandle('mcp:getTokenRotatedAt', async () => {
    return readRotatedAt()
  })
}
