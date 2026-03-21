import { getSetting } from './settings'

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export function getGitHubToken(): string | null {
  return getSetting('github.token') ?? process.env['GITHUB_TOKEN'] ?? null
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
