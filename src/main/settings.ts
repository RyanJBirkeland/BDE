import { getDb } from './db'
import {
  getSetting as _getSetting,
  setSetting as _setSetting,
  deleteSetting as _deleteSetting,
  getSettingJson as _getSettingJson,
  setSettingJson as _setSettingJson,
} from './data/settings-queries'

export function getSetting(key: string): string | null {
  return _getSetting(getDb(), key)
}

export function setSetting(key: string, value: string): void {
  _setSetting(getDb(), key, value)
}

export function deleteSetting(key: string): void {
  _deleteSetting(getDb(), key)
}

export function getSettingJson<T>(key: string): T | null {
  return _getSettingJson<T>(getDb(), key)
}

export function setSettingJson<T>(key: string, value: T): void {
  _setSettingJson<T>(getDb(), key, value)
}

// Well-known setting keys
export const SETTING_AGENT_BINARY = 'agent.binary'
export const SETTING_AGENT_PERMISSION_MODE = 'agent.permissionMode'

// Defaults
export const DEFAULT_AGENT_BINARY = 'claude'
export const DEFAULT_PERMISSION_MODE = 'bypassPermissions'

export function getAgentBinary(): string {
  return getSetting(SETTING_AGENT_BINARY) || DEFAULT_AGENT_BINARY
}

export function getAgentPermissionMode(): string {
  return getSetting(SETTING_AGENT_PERMISSION_MODE) || DEFAULT_PERMISSION_MODE
}

export const SETTING_MAX_CONCURRENT = 'agentManager.maxConcurrent'
export const SETTING_WORKTREE_BASE = 'agentManager.worktreeBase'
export const SETTING_MAX_RUNTIME_MINUTES = 'agentManager.maxRuntimeMinutes'

export function getMaxConcurrent(): number {
  return parseInt(getSetting(SETTING_MAX_CONCURRENT) ?? '3', 10)
}

export function getWorktreeBase(): string {
  return getSetting(SETTING_WORKTREE_BASE) ?? '/tmp/worktrees/bde'
}

export function getMaxRuntimeMinutes(): number {
  return parseInt(getSetting(SETTING_MAX_RUNTIME_MINUTES) ?? '60', 10)
}
