interface PriorityChipProps {
  priority: number
}

function priorityColor(p: number): string {
  if (p <= 1) return 'var(--st-failed)'
  if (p === 2) return 'var(--st-blocked)'
  return 'var(--fg-3)'
}

export function PriorityChip({ priority }: PriorityChipProps): React.JSX.Element {
  const color = priorityColor(priority)
  return (
    <span
      style={{
        padding: '0 4px',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.05em',
        color,
        border: `1px solid color-mix(in oklch, ${color} 30%, transparent)`,
        borderRadius: 3,
        lineHeight: 1.6,
        flexShrink: 0,
      }}
    >
      P{priority}
    </span>
  )
}
