// Pure formatting functions — may import from lib/ but not from stores, components, or IPC

import type { RepoOption } from './constants'

/**
 * Human-readable relative time: "just now", "3m ago", "2h ago", "5d ago".
 * Accepts epoch-ms (number) or an ISO/date string.
 */
export function timeAgo(ts: number | string): string {
  const epoch = typeof ts === 'string' ? new Date(ts).getTime() : ts
  const seconds = Math.floor((Date.now() - epoch) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Live elapsed time from a start timestamp: "12s", "3m 12s", "1h 02m".
 * Accepts epoch-ms (number) or an ISO/date string.
 */
export function formatElapsed(input: number | string): string {
  const startedAtMs = typeof input === 'string' ? Date.parse(input) : input
  const seconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/**
 * Duration between two timestamps: "3m 12s".
 * Returns empty string if finishedAt is null.
 */
export function formatDuration(
  startedAt: string | number,
  finishedAt: string | number | null
): string {
  if (!finishedAt) return ''
  const startMs = typeof startedAt === 'string' ? new Date(startedAt).getTime() : startedAt
  const endMs = typeof finishedAt === 'string' ? new Date(finishedAt).getTime() : finishedAt
  const seconds = Math.floor((endMs - startMs) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/**
 * Format milliseconds to human-readable duration: "3m 12s".
 * Returns "--" for null/undefined/NaN.
 */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '--'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/**
 * Format token count to compact human-readable form: 1234567 → "1.2M", 45200 → "45.2K".
 * Returns "--" for null/undefined/NaN.
 */
export function formatTokens(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '--'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

/**
 * Short model badge label: "claude-sonnet-4-5-20250929" → "sonnet".
 */
export function modelBadgeLabel(model: string): string {
  if (model.includes('opus')) return 'opus'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('haiku')) return 'haiku'
  return model.split('-')[0] ?? model
}

/**
 * Friendly short key for session display.
 * Returns the last segment of a colon-delimited key, or "Session" if it looks like a UUID.
 */
export function shortKey(sessionKey: string): string {
  const parts = sessionKey.split(':')
  const last = parts[parts.length - 1] ?? sessionKey
  if (/^[0-9a-f]{8,}$/i.test(last)) return 'Session'
  return last
}

/**
 * Format a timestamp to locale time string: "2:34 PM".
 * Accepts epoch-ms (number) or an ISO/date string.
 */
export function formatTime(ts: number | string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/**
 * Badge variant for a repo name. Derives variant from the repo's position in the configured
 * repos list (index-based cycle: 0→info, 1→warning, 2→success, 3+→info, ...).
 * Falls back to 'default' for unknown repos.
 */
export function repoBadgeVariant(
  repoName: string,
  repos: RepoOption[]
): 'default' | 'info' | 'warning' | 'success' {
  const VARIANTS = ['info', 'warning', 'success'] as const
  const idx = repos.findIndex((r) => r.label.toLowerCase() === repoName.toLowerCase())
  if (idx === -1) return 'default'
  return VARIANTS[idx % VARIANTS.length] ?? 'default'
}

/**
 * Repo dot color. Case-insensitive lookup against provided repo options.
 * Falls back to dim text color when no match found.
 */
export function repoColor(repoName: string, repos: RepoOption[]): string {
  return (
    repos.find((r) => r.label.toLowerCase() === repoName.toLowerCase())?.color ??
    'var(--bde-text-dim)'
  )
}

/**
 * Format date to short locale format: "Jan 5", "Dec 25".
 * Returns "—" if the input is null or invalid.
 */
export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return '—'
  }
}
