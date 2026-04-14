/**
 * Shared task formatting utilities for Sprint Pipeline
 */

export { formatElapsed } from './format'

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
