import React, { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'

export interface EpicProgressProps {
  tasks: SprintTask[]
  tasksNeedingSpecs: number
  tasksReadyToQueue: number
}

interface StatusCounts {
  done: number
  active: number
  queued: number
  blocked: number
  draft: number
}

export function EpicProgress({ tasks, tasksNeedingSpecs }: EpicProgressProps): React.JSX.Element {
  const counts: StatusCounts = useMemo(() => {
    const initial: StatusCounts = { done: 0, active: 0, queued: 0, blocked: 0, draft: 0 }
    return tasks.reduce((acc, task) => {
      if (task.status === 'done') acc.done++
      else if (task.status === 'active') acc.active++
      else if (task.status === 'queued') acc.queued++
      else if (task.status === 'blocked') acc.blocked++
      else if (task.status === 'backlog') acc.draft++
      return acc
    }, initial)
  }, [tasks])

  const progressPercent = useMemo(() => {
    if (tasks.length === 0) return 0
    return Math.round((counts.done / tasks.length) * 100)
  }, [counts.done, tasks.length])

  const progressColor = useMemo(() => {
    if (progressPercent === 100) return 'var(--bde-accent)'
    if (progressPercent >= 50) return 'var(--bde-status-review)'
    if (progressPercent > 0) return 'var(--bde-warning)'
    return 'var(--bde-text-dim)'
  }, [progressPercent])

  return (
    <div className="epic-detail__progress">
      <div className="epic-detail__progress-bar-track">
        <div
          className="epic-detail__progress-bar-fill"
          style={{
            width: `${progressPercent}%`,
            background: progressColor
          }}
        />
      </div>
      <div className="epic-detail__status-breakdown">
        <span className="epic-detail__status-count epic-detail__status-count--done">
          {counts.done} done
        </span>
        <span className="epic-detail__status-count epic-detail__status-count--active">
          {counts.active} active
        </span>
        <span className="epic-detail__status-count epic-detail__status-count--queued">
          {counts.queued} queued
        </span>
        <span className="epic-detail__status-count epic-detail__status-count--blocked">
          {counts.blocked} blocked
        </span>
        <span className="epic-detail__status-count epic-detail__status-count--draft">
          {counts.draft} draft
        </span>
      </div>

      {tasksNeedingSpecs > 0 && (
        <div className="epic-detail__readiness-warning">
          <AlertTriangle size={14} />
          <span>
            {tasksNeedingSpecs} task{tasksNeedingSpecs === 1 ? '' : 's'} missing specs
          </span>
        </div>
      )}
    </div>
  )
}
