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
  if (prStatus === 'open' || prStatus === 'branch_only') return 'var(--bde-status-review)'
  switch (status) {
    case 'queued':
      return 'var(--bde-accent)'
    case 'blocked':
      return 'var(--bde-warning)'
    case 'active':
      return 'var(--bde-status-active)'
    case 'review':
      return 'var(--bde-status-review)'
    case 'done':
      return 'var(--bde-status-done)'
    case 'failed':
    case 'error':
    case 'cancelled':
      return 'var(--bde-danger)'
    default:
      return 'var(--bde-accent)'
  }
}
