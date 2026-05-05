import React from 'react'

interface PriorityChipProps {
  priority: number
}

const PRIORITY_LABELS: Record<number, string> = {
  1: 'P1',
  2: 'P2',
  3: 'P3',
}

const PRIORITY_COLORS: Record<number, string> = {
  1: 'var(--st-failed)',
  2: 'var(--st-queued)',
  3: 'var(--fg-3)',
}

export function PriorityChip({ priority }: PriorityChipProps): React.JSX.Element | null {
  const label = PRIORITY_LABELS[priority]
  if (label == null) return null

  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 600,
        color: PRIORITY_COLORS[priority] ?? 'var(--fg-3)',
        padding: '1px 4px',
        border: `1px solid ${PRIORITY_COLORS[priority] ?? 'var(--line)'}`,
        borderRadius: 'var(--r-sm)',
        flexShrink: 0,
        lineHeight: 1.4,
      }}
    >
      {label}
    </span>
  )
}
