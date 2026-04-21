import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Clock, Zap, GitBranch, Slash, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'
import { SPRINGS } from '../../lib/motion'
import { formatElapsed } from '../../lib/task-format'
import { STATUS_METADATA } from '../../lib/task-status-ui'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'
import { useSprintSelection } from '../../stores/sprintSelection'
import { formatDuration } from '../../lib/format'
import { useTaskCost } from '../../hooks/useTaskCost'
import { TagBadge } from '../ui/TagBadge'

import './TaskPill.css'

interface TaskPillProps {
  task: SprintTask
  selected: boolean
  multiSelected?: boolean | undefined
  onClick: (id: string) => void
}

function getStatusClass(status: string, prStatus?: string | null): string {
  if (prStatus === 'branch_only') return 'task-pill--branch-only'
  if (status === 'active' && prStatus !== 'open') return 'task-pill--active'
  if (status === 'blocked') return 'task-pill--blocked'
  if ((status === 'active' || status === 'done') && prStatus === 'open') return 'task-pill--review'
  if (status === 'done') return 'task-pill--done'
  return ''
}

function getFailureInfo(
  task: SprintTask
): { icon: LucideIcon; label: string; className: string } | null {
  if (task.status !== 'failed' && task.status !== 'error' && task.status !== 'cancelled')
    return null
  if (task.fast_fail_count >= 3)
    return { icon: Zap, label: 'Fast-fail', className: 'task-pill__fail--fastfail' }
  if (task.pr_url || task.pr_status === 'branch_only')
    return { icon: GitBranch, label: 'Push failed', className: 'task-pill__fail--push' }
  if (task.status === 'cancelled')
    return { icon: Slash, label: 'Cancelled', className: 'task-pill__fail--cancelled' }
  return { icon: XCircle, label: 'Agent failed', className: 'task-pill__fail--agent' }
}

function TaskPillInner({
  task,
  selected,
  multiSelected,
  onClick
}: TaskPillProps): React.JSX.Element {
  const [elapsed, setElapsed] = useState('')
  const [arriving, setArriving] = useState(false)
  const prevStatusRef = useRef(task.status)
  const { costUsd } = useTaskCost(task.agent_run_id)

  useEffect(() => {
    if (task.status !== prevStatusRef.current) {
      prevStatusRef.current = task.status
      setArriving(true)
      const timer = setTimeout(() => setArriving(false), 500)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [task.status])

  const isActive = task.status === 'active' && !!task.started_at
  useBackoffInterval(() => setElapsed(formatElapsed(task.started_at!)), isActive ? 10_000 : null)
  // Set initial elapsed value when task becomes active
  useEffect(() => {
    if (isActive) setElapsed(formatElapsed(task.started_at!))
  }, [isActive, task.started_at])

  const isZombie = task.status === 'active' && (!!task.pr_url || !!task.pr_status)
  const isStale =
    task.status === 'active' &&
    !!task.started_at &&
    // eslint-disable-next-line react-hooks/purity -- Date.now() in render is intentional for stale detection
    Date.now() - new Date(task.started_at).getTime() > (task.max_runtime_ms ?? 3600000)
  const failureInfo = getFailureInfo(task)

  const statusClass = getStatusClass(task.status, task.pr_status)
  const classes = [
    'task-pill',
    statusClass,
    selected ? 'task-pill--selected' : '',
    multiSelected ? 'task-pill--multi-selected' : '',
    arriving ? 'task-pill--arriving' : '',
    isZombie ? 'task-pill--zombie' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const toggleTaskSelection = useSprintSelection((s) => s.toggleTaskSelection)
  const clearSelection = useSprintSelection((s) => s.clearSelection)

  const handleClick = (e: React.MouseEvent): void => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault()
      toggleTaskSelection(task.id)
    } else {
      clearSelection()
      onClick(task.id)
    }
  }

  return (
    <motion.div
      layoutId={task.id}
      className={classes}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`Task: ${task.title}, status: ${task.status}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            toggleTaskSelection(task.id)
          } else {
            onClick(task.id)
          }
        }
      }}
      transition={SPRINGS.default}
      data-testid="task-pill"
    >
      <div
        className="task-pill__dot"
        style={{
          background:
            task.pr_status === 'open' || task.pr_status === 'branch_only'
              ? 'var(--bde-status-review)'
              : `var(${STATUS_METADATA[task.status].colorToken})`
        }}
      />
      {failureInfo && (
        <span title={failureInfo.label}>
          <failureInfo.icon
            size={10}
            className={failureInfo.className}
            aria-label={failureInfo.label}
          />
        </span>
      )}
      {isZombie && (
        <span title="Agent finished but task not marked done">
          <AlertTriangle size={12} className="task-pill__zombie-icon" aria-label="Zombie task" />
        </span>
      )}
      {isStale && !isZombie && (
        <span title="Task may be stuck">
          <Clock size={12} className="task-pill__stale-icon" aria-label="Stale task" />
        </span>
      )}
      <span className="task-pill__title" title={task.title}>
        {task.title}
      </span>
      <span
        className="task-pill__badge"
        style={{ background: 'var(--bde-accent-surface)', color: 'var(--bde-accent)' }}
      >
        {task.repo}
      </span>
      {task.tags && task.tags.length > 0 && (
        <div className="task-pill__tags">
          {task.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} size="sm" />
          ))}
        </div>
      )}
      {elapsed && <span className="task-pill__time">{elapsed}</span>}
      {task.status === 'done' && task.started_at && task.completed_at && (
        <span className="task-pill__duration">
          {formatDuration(task.started_at, task.completed_at)}
        </span>
      )}
      {(task.status === 'done' || task.status === 'review') &&
        task.agent_run_id &&
        costUsd !== null && (
          <span className="task-pill__cost" title={`Agent execution cost: $${costUsd.toFixed(2)}`}>
            ${costUsd.toFixed(2)}
          </span>
        )}
      {task.status === 'active' && !isZombie && <span className="task-pill__activity" />}
    </motion.div>
  )
}

export const TaskPill = React.memo(TaskPillInner)
TaskPill.displayName = 'TaskPill'
