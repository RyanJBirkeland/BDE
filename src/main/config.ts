import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { dialog, app } from 'electron'

interface GatewayConfig {
  url: string
  token: string
}

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json')
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    // config file missing or corrupt
  }

  const url =
    (config.supabaseUrl as string) ?? process.env['VITE_SUPABASE_URL'] ?? null
  const anonKey =
    (config.supabaseAnonKey as string) ?? process.env['VITE_SUPABASE_ANON_KEY'] ?? null

  if (!url || !anonKey) return null
  return { url, anonKey }
}

export function getGitHubToken(): string | null {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json')
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw)
    return config.githubToken ?? process.env['GITHUB_TOKEN'] ?? null
  } catch {
    return process.env['GITHUB_TOKEN'] ?? null
  }
}

export function saveGatewayConfig(url: string, token: string): void {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json')

  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    // start fresh if file missing or corrupt
  }

  config.gatewayUrl = url
  config.gatewayToken = token
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

// Gateway config cache — avoids readFileSync + JSON.parse on every IPC call
let _configCache: GatewayConfig | null = null
let _configCachedAt = 0
const CONFIG_CACHE_TTL = 60_000

export interface TaskRunnerConfig {
  url: string
  apiKey: string
}

export function getTaskRunnerConfig(): TaskRunnerConfig | null {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json')
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    // config file missing or corrupt — fall through to env vars
  }

  const apiKey = (config.sprintApiKey as string) ?? process.env['SPRINT_API_KEY'] ?? null
  const url = (config.taskRunnerUrl as string) ?? process.env['TASK_RUNNER_URL'] ?? 'http://127.0.0.1:18799'

  if (!apiKey) return null
  return { url, apiKey }
}

export function getGatewayConfig(): GatewayConfig {
  const now = Date.now()
  if (_configCache && now - _configCachedAt < CONFIG_CACHE_TTL) {
    return _configCache
  }

  const configPath = join(homedir(), '.openclaw', 'openclaw.json')

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw)

    const token = config.gatewayToken ?? config.gateway?.auth?.token
    const url = config.gatewayUrl ?? `ws://127.0.0.1:${config.gateway?.port ?? 18789}`

    if (!token) {
      dialog.showErrorBox(
        'BDE — Missing Gateway Token',
        'No gatewayToken found in ~/.openclaw/openclaw.json.\nPlease run `openclaw onboard` first.'
      )
      app.quit()
      throw new Error('Missing gatewayToken')
    }

    _configCache = { url, token }
    _configCachedAt = now
    return _configCache
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      dialog.showErrorBox(
        'BDE — Config Not Found',
        'Could not find ~/.openclaw/openclaw.json.\nPlease install and configure OpenClaw first.'
      )
      app.quit()
    }
    throw err
  }
}
