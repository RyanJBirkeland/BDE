import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getDb } from './db'
import { OPENCLAW_CONFIG_PATH } from './paths'

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value)
}

export function deleteSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
}

export function getSettingJson<T>(key: string): T | null {
  const raw = getSetting(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function setSettingJson<T>(key: string, value: T): void {
  setSetting(key, JSON.stringify(value))
}

/**
 * One-time migration: import configuration from OpenClaw's openclaw.json
 * into the BDE settings table. Only runs if no gateway.url is set yet.
 */
export function migrateFromOpenClawConfig(): void {
  if (getSetting('gateway.url')) return

  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8'))
  } catch {
    return // No OpenClaw config to import
  }

  const gateway = config.gateway as Record<string, unknown> | undefined
  const gatewayAuth = gateway?.auth as Record<string, unknown> | undefined
  const token = (config.gatewayToken ?? gatewayAuth?.token) as string | undefined
  const url = (config.gatewayUrl ??
    `ws://127.0.0.1:${gateway?.port ?? 18789}`) as string
  const githubToken = config.githubToken as string | undefined
  const sprintApiKey = config.sprintApiKey as string | undefined
  const taskRunnerUrl = config.taskRunnerUrl as string | undefined

  if (url) setSetting('gateway.url', url)
  if (token) setSetting('gateway.token', token)
  if (githubToken) setSetting('github.token', githubToken)
  if (sprintApiKey) setSetting('taskRunner.apiKey', sprintApiKey)
  if (taskRunnerUrl) setSetting('taskRunner.url', taskRunnerUrl)

  // Import default repos
  const defaultRepos = [
    { name: 'BDE', localPath: join(homedir(), 'Documents', 'Repositories', 'BDE'), githubOwner: 'RyanJBirkeland', githubRepo: 'BDE', color: '#6C8EEF' },
    { name: 'life-os', localPath: join(homedir(), 'Documents', 'Repositories', 'life-os'), githubOwner: 'RyanJBirkeland', githubRepo: 'life-os', color: '#00D37F' },
    { name: 'feast', localPath: join(homedir(), 'Documents', 'Repositories', 'feast'), githubOwner: 'RyanJBirkeland', githubRepo: 'feast', color: '#FF8A00' },
  ]
  setSettingJson('repos', defaultRepos)

  console.log('[settings] Imported configuration from OpenClaw config')
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
