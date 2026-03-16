// All pure functions — no imports from stores, components, or IPC

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
 */
export function formatElapsed(startedAtMs: number): string {
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
 * Format an ISO timestamp to locale time string: "2:34 PM".
 */
export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
