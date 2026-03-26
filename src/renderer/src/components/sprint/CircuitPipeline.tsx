/**
 * CircuitPipeline — Top zone showing task counts across pipeline stages.
 * Stages are clickable to filter the task list.
 */
import React, { useMemo } from 'react'
import type { SprintTask } from '../../../../shared/types'

interface StageConfig {
  label: string
  filter: string
  accent: string
  alwaysShow: boolean
}

const STAGES: StageConfig[] = [
  { label: 'Backlog', filter: 'backlog', accent: 'blue', alwaysShow: false },
  { label: 'Queued', filter: 'todo', accent: 'cyan', alwaysShow: false },
  { label: 'Active', filter: 'in-progress', accent: 'purple', alwaysShow: false },
  { label: 'Done', filter: 'done', accent: 'pink', alwaysShow: false },
  { label: 'Blocked', filter: 'blocked', accent: 'orange', alwaysShow: true },
  { label: 'Failed', filter: 'failed', accent: 'red', alwaysShow: true }
]

function countForStage(tasks: SprintTask[], filter: string): number {
  switch (filter) {
    case 'backlog':
      return tasks.filter((t) => t.status === 'backlog').length
    case 'todo':
      return tasks.filter((t) => t.status === 'queued').length
    case 'in-progress':
      return tasks.filter((t) => t.status === 'active').length
    case 'done':
      return tasks.filter((t) => t.status === 'done').length
    case 'blocked':
      return tasks.filter((t) => t.status === 'blocked').length
    case 'failed':
      return tasks.filter(
        (t) => t.status === 'failed' || t.status === 'error' || t.status === 'cancelled'
      ).length
    default:
      return 0
  }
}

function accentVars(accent: string) {
  return {
    background: `var(--neon-${accent}-surface)`,
    borderColor: `var(--neon-${accent}-border)`,
    color: `var(--neon-${accent}-color, var(--neon-${accent}))`
  }
}

interface CircuitPipelineProps {
  tasks: SprintTask[]
  statusFilter?: string
  onStageClick?: (filter: string) => void
}

export function CircuitPipeline({ tasks, statusFilter, onStageClick }: CircuitPipelineProps) {
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of STAGES) {
      counts[s.filter] = countForStage(tasks, s.filter)
    }
    return counts
  }, [tasks])

  return (
    <div className="circuit-pipeline">
      <span className="circuit-pipeline__label">Task Pipeline</span>
      <div className="circuit-pipeline__stages">
        {STAGES.map((s, i) => {
          const count = stageCounts[s.filter]
          if (!s.alwaysShow && count === 0) return null
          const isActive = statusFilter === s.filter
          return (
            <React.Fragment key={s.filter}>
              {i > 0 && count > 0 && <span className="circuit-pipeline__arrow">&rsaquo;</span>}
              {i > 0 && count === 0 && s.alwaysShow && (
                <span className="circuit-pipeline__arrow">&rsaquo;</span>
              )}
              <button
                className={`circuit-pipeline__stage${isActive ? ' circuit-pipeline__stage--active' : ''}`}
                style={{ ...accentVars(s.accent), opacity: count === 0 ? 0.5 : 1 }}
                onClick={() => onStageClick?.(isActive ? 'all' : s.filter)}
              >
                {s.label} {count}
              </button>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
