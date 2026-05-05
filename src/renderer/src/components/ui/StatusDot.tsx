import React from 'react'
import type { TaskStatus } from '../../../../shared/task-state-machine'

interface StatusDotProps {
  status: TaskStatus
  pulse?: boolean
}

const STATUS_TOKEN: Record<TaskStatus, string> = {
  backlog: 'var(--fg-4)',
  queued: 'var(--st-queued)',
  blocked: 'var(--st-blocked)',
  active: 'var(--st-running)',
  review: 'var(--st-review)',
  approved: 'var(--st-done)',
  done: 'var(--st-done)',
  cancelled: 'var(--fg-4)',
  failed: 'var(--st-failed)',
  error: 'var(--st-failed)',
}

export function StatusDot({ status, pulse = false }: StatusDotProps): React.JSX.Element {
  const color = STATUS_TOKEN[status] ?? 'var(--fg-4)'
  const shouldPulse = pulse && status === 'active'

  return (
    <span
      aria-hidden="true"
      className={shouldPulse ? 'fleet-pulse' : undefined}
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  )
}
