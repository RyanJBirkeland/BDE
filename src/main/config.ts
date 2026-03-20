import { getSetting } from './settings'

interface GatewayConfig {
  url: string
  token: string
}

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export interface TaskRunnerConfig {
  url: string
  apiKey: string
}

export function getGatewayConfig(): GatewayConfig | null {
  const url = getSetting('gateway.url')
  const token = getSetting('gateway.token')
  if (!url || !token) return null
  return { url, token }
}

export function getGitHubToken(): string | null {
  return getSetting('github.token') ?? process.env['GITHUB_TOKEN'] ?? null
}

export function getTaskRunnerConfig(): TaskRunnerConfig | null {
  const apiKey = getSetting('taskRunner.apiKey') ?? process.env['SPRINT_API_KEY'] ?? null
  const url = getSetting('taskRunner.url') ?? process.env['TASK_RUNNER_URL'] ?? null
  if (!apiKey) return null
  return { url: url ?? 'http://127.0.0.1:18799', apiKey }
}

export function getAgentProvider(): 'sdk' | 'cli' {
  return (getSetting('agent.provider') as 'sdk' | 'cli') ?? 'sdk'
}

export function getEventRetentionDays(): number {
  return parseInt(getSetting('agent.eventRetentionDays') ?? '30', 10)
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = getSetting('supabase.url') ?? process.env['VITE_SUPABASE_URL'] ?? null
  const anonKey = getSetting('supabase.anonKey') ?? process.env['VITE_SUPABASE_ANON_KEY'] ?? null
  if (!url || !anonKey) return null
  return { url, anonKey }
}
