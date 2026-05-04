import type { JSX } from 'react'
import type { SprintTask } from '../../../../shared/types'
import { useTaskCost } from '../../hooks/useTaskCost'
import { formatDurationMs } from '../../lib/format'

interface Props {
  task: SprintTask
}

export function TaskRunMetrics({ task }: Props): JSX.Element | null {
  const { costUsd } = useTaskCost(task.agent_run_id)

  if (costUsd === null || !task.duration_ms) {
    return null
  }

  const costLabel = `$${costUsd.toFixed(2)}`
  const durationLabel = formatDurationMs(task.duration_ms)
  const retriesLabel = task.retry_count > 0 ? ` · ${task.retry_count} retries` : ''

  return (
    <span className="cr-run-metrics" aria-label={`Cost ${costLabel}, duration ${durationLabel}${retriesLabel}`}>
      {costLabel} · {durationLabel}{retriesLabel}
    </span>
  )
}
