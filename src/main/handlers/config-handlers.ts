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

/** Setting keys that require path safety validation before writing. */
const PATH_VALIDATORS: Record<string, (value: string) => void> = {
  'agentManager.worktreeBase': validateWorktreeBase
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
  })
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
    const { readOrCreateToken } = await import('../mcp-server/token-store')
    const { token } = await readOrCreateToken()
    return token
  })

  safeHandle('mcp:regenerateToken', async () => {
    const { regenerateToken } = await import('../mcp-server/token-store')
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
}
