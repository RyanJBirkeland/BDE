/**
 * Shared task formatting utilities for Sprint Pipeline
 */

export { formatElapsed } from './format'

export interface FailureCategory {
  label: string
  colorClass: string
}

/**
 * Maps a task's failure_reason field to a human-readable chip label and a
 * CSS class for colorizing it. Used by TaskPill and TaskDetailDrawer to give
 * users an at-a-glance categorisation without reading the full notes block.
 */
export function failureCategoryForReason(reason: string | null | undefined): FailureCategory {
  if (!reason) return { label: 'Unknown', colorClass: 'failure-chip--unknown' }
  switch (reason) {
    case 'timeout':
      return { label: 'Timeout', colorClass: 'failure-chip--timeout' }
    case 'test_failure':
      return { label: 'Test failure', colorClass: 'failure-chip--test' }
    case 'compilation':
      return { label: 'Compilation', colorClass: 'failure-chip--compilation' }
    case 'auth':
      return { label: 'Auth error', colorClass: 'failure-chip--auth' }
    case 'spawn':
      return { label: 'Spawn failed', colorClass: 'failure-chip--spawn' }
    case 'no_commits':
    case 'no-commits-exhausted':
      return { label: 'No commits', colorClass: 'failure-chip--no-commits' }
    case 'incomplete_files':
      return { label: 'Incomplete', colorClass: 'failure-chip--incomplete' }
    case 'environmental':
      return { label: 'Environment', colorClass: 'failure-chip--env' }
    case 'tip-mismatch':
      return { label: 'Tip mismatch', colorClass: 'failure-chip--tip-mismatch' }
    default:
      return { label: 'Unknown', colorClass: 'failure-chip--unknown' }
  }
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
