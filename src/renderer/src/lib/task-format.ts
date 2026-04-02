/**
 * Shared task formatting utilities for Sprint Pipeline
 */

export function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

export function getDotColor(status: string, prStatus?: string | null): string {
  if (prStatus === 'open' || prStatus === 'branch_only') return 'var(--neon-blue)'
  switch (status) {
    case 'queued':
      return 'var(--neon-cyan)'
    case 'blocked':
      return 'var(--neon-orange)'
    case 'active':
      return 'var(--neon-purple)'
    case 'review':
      return 'var(--neon-blue)'
    case 'done':
      return 'var(--neon-pink)'
    case 'failed':
    case 'error':
    case 'cancelled':
      return 'var(--neon-red, #ff3366)'
    default:
      return 'var(--neon-cyan)'
  }
}
