import type { JSX } from 'react'
import type { SprintTask } from '../../../../shared/types'
import { useTaskCost } from '../../hooks/useTaskCost'
import { formatDurationMs } from '../../lib/format'

interface Props {
  task: SprintTask
}

const SEPARATOR_STYLE: React.CSSProperties = {
  display: 'inline-block',
  width: 1,
  height: 6,
  background: 'var(--line)',
  margin: '0 var(--s-2)',
  verticalAlign: 'middle'
}

const VALUE_STYLE: React.CSSProperties = {
  color: 'var(--fg-2)',
  fontWeight: 500
}

const LABEL_STYLE: React.CSSProperties = {
  color: 'var(--fg-4)'
}

/**
 * Inline mono stats: cost · duration · retries.
 * V2: no background/border; items separated by 6px-tall vertical line separators.
 */
export function TaskRunMetrics({ task }: Props): JSX.Element | null {
  const { costUsd } = useTaskCost(task.agent_run_id)

  if (costUsd === null || !task.duration_ms) {
    return null
  }

  const costLabel = `$${costUsd.toFixed(2)}`
  const durationLabel = formatDurationMs(task.duration_ms)

  return (
    <span
      aria-label={`Cost ${costLabel}, duration ${durationLabel}${task.retry_count > 0 ? `, ${task.retry_count} retries` : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--t-2xs)',
        whiteSpace: 'nowrap'
      }}
    >
      <span style={VALUE_STYLE}>{costLabel}</span>
      <span style={LABEL_STYLE}> COST</span>
      <span style={SEPARATOR_STYLE} />
      <span style={VALUE_STYLE}>{durationLabel}</span>
      <span style={LABEL_STYLE}> TIME</span>
      {task.retry_count > 0 && (
        <>
          <span style={SEPARATOR_STYLE} />
          <span style={VALUE_STYLE}>{task.retry_count}</span>
          <span style={LABEL_STYLE}> RETRIES</span>
        </>
      )}
    </span>
  )
}
