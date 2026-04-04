import {
  getSetting,
  setSetting,
  deleteSetting,
  getSettingJson,
  setSettingJson
} from '../settings'

const PROFILE_PREFIX = 'profiles.'
const PROFILE_KEYS_TO_SAVE = [
  'agentManager.maxConcurrent',
  'agentManager.worktreeBase',
  'agentManager.maxRuntime',
  'agentManager.defaultModel',
  'appearance.theme',
  'appearance.reducedMotion'
]

/**
 * Save current settings as a named profile
 */
export function saveProfile(name: string): void {
  const snapshot: Record<string, string | null> = {}
  for (const key of PROFILE_KEYS_TO_SAVE) {
    snapshot[key] = getSetting(key)
  }
  setSettingJson(`${PROFILE_PREFIX}${name}`, snapshot)

  // Update manifest
  const manifest = getSettingJson<string[]>('profiles._manifest') ?? []
  if (!manifest.includes(name)) {
    setSettingJson('profiles._manifest', [...manifest, name])
  } else {
    // Profile already exists in manifest, no need to add
    setSettingJson('profiles._manifest', manifest)
  }
}

/**
 * Load a profile's settings snapshot
 */
export function loadProfile(name: string): Record<string, string | null> | null {
  return getSettingJson<Record<string, string | null>>(`${PROFILE_PREFIX}${name}`)
}

/**
 * Apply a profile's settings to the current configuration
 */
export function applyProfile(name: string): boolean {
  const snapshot = loadProfile(name)
  if (!snapshot) return false

  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== null) {
      setSetting(key, value)
    } else {
      deleteSetting(key)
    }
  }
  return true
}

/**
 * List all available profile names
 */
export function listProfiles(): string[] {
  return getSettingJson<string[]>('profiles._manifest') ?? []
}

/**
 * Delete a profile
 */
export function deleteProfile(name: string): void {
  deleteSetting(`${PROFILE_PREFIX}${name}`)
  const manifest = getSettingJson<string[]>('profiles._manifest') ?? []
  setSettingJson(
    'profiles._manifest',
    manifest.filter((n) => n !== name)
  )
}
