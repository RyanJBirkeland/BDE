import React, { useMemo } from 'react'
import { Edit2, MoreVertical, AlertTriangle } from 'lucide-react'
import type { TaskGroup, SprintTask } from '../../../../shared/types'
import { tokens } from '../../design-system/tokens'

export interface EpicDetailProps {
  group: TaskGroup
  tasks: SprintTask[]
  onQueueAll: () => void
  onAddTask: () => void
  onEditTask: (taskId: string) => void
  onEditGroup?: () => void
}

interface StatusCounts {
  done: number
  active: number
  queued: number
  blocked: number
  draft: number
}

export function EpicDetail({
  group,
  tasks,
  onQueueAll,
  onAddTask,
  onEditTask,
  onEditGroup
}: EpicDetailProps): React.JSX.Element {
  // Calculate status breakdown
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

  // Count tasks missing specs (backlog/draft tasks with no spec)
  const tasksNeedingSpecs = useMemo(() => {
    return tasks.filter((t) => t.status === 'backlog' && (!t.spec || t.spec.trim() === '')).length
  }, [tasks])

  // Count tasks ready to queue (backlog tasks WITH specs)
  const tasksReadyToQueue = useMemo(() => {
    return tasks.filter((t) => t.status === 'backlog' && t.spec && t.spec.trim() !== '').length
  }, [tasks])

  // Progress percentage
  const progressPercent = useMemo(() => {
    if (tasks.length === 0) return 0
    return Math.round((counts.done / tasks.length) * 100)
  }, [counts.done, tasks.length])

  const progressColor = useMemo(() => {
    if (progressPercent === 100) return tokens.neon.cyan
    if (progressPercent >= 50) return tokens.neon.blue
    if (progressPercent > 0) return tokens.neon.orange
    return tokens.neon.textDim
  }, [progressPercent])

  // Helper to get status dot color
  const getStatusColor = (status: SprintTask['status']): string => {
    switch (status) {
      case 'done':
        return tokens.neon.cyan
      case 'active':
        return tokens.neon.blue
      case 'queued':
        return tokens.neon.orange
      case 'blocked':
        return tokens.neon.red
      case 'review':
        return tokens.neon.purple
      case 'failed':
      case 'error':
        return tokens.neon.red
      case 'cancelled':
        return tokens.neon.textDim
      case 'backlog':
      default:
        return tokens.neon.textMuted
    }
  }

  // Helper to get status label
  const getStatusLabel = (status: SprintTask['status']): string => {
    switch (status) {
      case 'done':
        return 'Done'
      case 'active':
        return 'Active'
      case 'queued':
        return 'Queued'
      case 'blocked':
        return 'Blocked'
      case 'review':
        return 'Review'
      case 'failed':
        return 'Failed'
      case 'error':
        return 'Error'
      case 'cancelled':
        return 'Cancelled'
      case 'backlog':
      default:
        return 'Draft'
    }
  }

  const queueDisabled = tasksNeedingSpecs > 0

  return (
    <div className="epic-detail">
      {/* Header */}
      <div className="epic-detail__header">
        <div
          className="epic-detail__icon"
          style={{
            background: `${group.accent_color}20`,
            color: group.accent_color,
            borderColor: `${group.accent_color}40`
          }}
        >
          {group.icon.charAt(0).toUpperCase()}
        </div>
        <div className="epic-detail__header-content">
          <h2 className="epic-detail__name">{group.name}</h2>
          {group.goal && <p className="epic-detail__goal">{group.goal}</p>}
        </div>
        <div className="epic-detail__header-actions">
          {onEditGroup && (
            <button
              type="button"
              className="epic-detail__header-btn"
              onClick={onEditGroup}
              aria-label="Edit epic"
            >
              <Edit2 size={16} />
            </button>
          )}
          <button type="button" className="epic-detail__header-btn" aria-label="More options">
            <MoreVertical size={16} />
          </button>
        </div>
      </div>

      {/* Progress Section */}
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
          <span className="epic-detail__status-count" style={{ color: tokens.neon.cyan }}>
            {counts.done} done
          </span>
          <span className="epic-detail__status-count" style={{ color: tokens.neon.blue }}>
            {counts.active} active
          </span>
          <span className="epic-detail__status-count" style={{ color: tokens.neon.orange }}>
            {counts.queued} queued
          </span>
          <span className="epic-detail__status-count" style={{ color: tokens.neon.red }}>
            {counts.blocked} blocked
          </span>
          <span className="epic-detail__status-count" style={{ color: tokens.neon.textMuted }}>
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

      {/* Task List */}
      <div className="epic-detail__tasks">
        {tasks.map((task) => {
          const hasSpec = task.spec && task.spec.trim() !== ''
          const hasDeps = task.depends_on && task.depends_on.length > 0

          return (
            <div key={task.id} className="epic-detail__task-row">
              <div
                className="epic-detail__task-status-dot"
                style={{ background: getStatusColor(task.status) }}
              />
              <span className="epic-detail__task-title">{task.title}</span>
              {!hasSpec && task.status === 'backlog' && (
                <span className="epic-detail__task-flag epic-detail__task-flag--warning">
                  no spec
                </span>
              )}
              {hasDeps && task.depends_on && (
                <span className="epic-detail__task-dep-ref">
                  {task.depends_on.length} dep{task.depends_on.length === 1 ? '' : 's'}
                </span>
              )}
              <span
                className="epic-detail__task-status-badge"
                style={{ color: getStatusColor(task.status) }}
              >
                {getStatusLabel(task.status)}
              </span>
              <button
                type="button"
                className="epic-detail__task-edit-btn"
                onClick={() => onEditTask(task.id)}
                aria-label={`Edit ${task.title}`}
              >
                <Edit2 size={14} />
              </button>
            </div>
          )
        })}

        <button type="button" className="epic-detail__add-task-row" onClick={onAddTask}>
          + Add task
        </button>
      </div>

      {/* Queue Bar (sticky bottom) */}
      <div className="epic-detail__queue-bar">
        <div className="epic-detail__queue-info">
          <span className="epic-detail__queue-ready">
            {tasksReadyToQueue} task{tasksReadyToQueue === 1 ? '' : 's'} ready to queue
          </span>
          {tasksNeedingSpecs > 0 && (
            <>
              <span className="epic-detail__queue-separator">·</span>
              <span className="epic-detail__queue-needs-specs">
                {tasksNeedingSpecs} need{tasksNeedingSpecs === 1 ? 's' : ''} specs
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          className="epic-detail__queue-btn"
          onClick={onQueueAll}
          disabled={queueDisabled}
        >
          Send to Pipeline
        </button>
      </div>
    </div>
  )
}
