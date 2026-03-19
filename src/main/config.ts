import { readFileSync, writeFileSync } from 'fs'
import { OPENCLAW_CONFIG_PATH } from './paths'

interface GatewayConfig {
  url: string
  token: string
}

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export function getSupabaseConfig(): SupabaseConfig | null {
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8'))
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
  try {
    const raw = readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8')
    const config = JSON.parse(raw)
    return config.githubToken ?? process.env['GITHUB_TOKEN'] ?? null
  } catch {
    return process.env['GITHUB_TOKEN'] ?? null
  }
}

export function saveGatewayConfig(url: string, token: string): void {
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8'))
  } catch {
    // start fresh if file missing or corrupt
  }

  config.gatewayUrl = url
  config.gatewayToken = token
  writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
  invalidateGatewayConfigCache()
}

export function invalidateGatewayConfigCache(): void {
  _configCache = null
  _configCachedAt = 0
}

// Gateway config cache — avoids readFileSync + JSON.parse on every IPC call
let _configCache: GatewayConfig | null = null
let _configCachedAt = 0
const CONFIG_CACHE_TTL = 60_000

export function clearConfigCache(): void {
  _configCache = null
  _configCachedAt = 0
}

export interface TaskRunnerConfig {
  url: string
  apiKey: string
}

export function getTaskRunnerConfig(): TaskRunnerConfig | null {
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8'))
  } catch {
    // config file missing or corrupt — fall through to env vars
  }

  const apiKey = (config.sprintApiKey as string) ?? process.env['SPRINT_API_KEY'] ?? null
  const url = (config.taskRunnerUrl as string) ?? process.env['TASK_RUNNER_URL'] ?? 'http://127.0.0.1:18799'

  if (!apiKey) return null
  return { url, apiKey }
}

export class GatewayConfigError extends Error {
  constructor(
    message: string,
    public readonly reason: 'missing-token' | 'missing-file'
  ) {
    super(message)
    this.name = 'GatewayConfigError'
  }
}

export function getGatewayConfig(): GatewayConfig {
  const now = Date.now()
  if (_configCache && now - _configCachedAt < CONFIG_CACHE_TTL) {
    return _configCache
  }

  try {
    const raw = readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8')
    const config = JSON.parse(raw)

    const token = config.gatewayToken ?? config.gateway?.auth?.token
    const url = config.gatewayUrl ?? `ws://127.0.0.1:${config.gateway?.port ?? 18789}`

    if (!token) {
      throw new GatewayConfigError(
        'No gatewayToken found in ~/.openclaw/openclaw.json. Please run `openclaw onboard` first.',
        'missing-token'
      )
    }

    _configCache = { url, token }
    _configCachedAt = now
    return _configCache
  } catch (err) {
    if (err instanceof GatewayConfigError) throw err
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new GatewayConfigError(
        'Could not find ~/.openclaw/openclaw.json. Please install and configure OpenClaw first.',
        'missing-file'
      )
    }
    throw err
  }
}
