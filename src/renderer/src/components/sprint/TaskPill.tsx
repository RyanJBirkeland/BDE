import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Clock, Zap, GitBranch, Slash, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'
import { SPRINGS } from '../../lib/motion'
import { formatElapsed, getDotColor } from '../../lib/task-format'
import { useSprintUI } from '../../stores/sprintUI'

interface TaskPillProps {
  task: SprintTask
  selected: boolean
  multiSelected?: boolean
  onClick: (id: string) => void
}

function formatDuration(startedAt: string, completedAt: string): string {
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

function getStatusClass(status: string, prStatus?: string | null): string {
  if (prStatus === 'branch_only') return 'task-pill--branch-only'
  if (status === 'active' && prStatus !== 'open') return 'task-pill--active'
  if (status === 'blocked') return 'task-pill--blocked'
  if ((status === 'active' || status === 'done') && prStatus === 'open') return 'task-pill--review'
  if (status === 'done') return 'task-pill--done'
  return ''
}

function getFailureInfo(task: SprintTask): { icon: LucideIcon; label: string; className: string } | null {
  if (task.status !== 'failed' && task.status !== 'error' && task.status !== 'cancelled') return null
  if (task.fast_fail_count >= 3) return { icon: Zap, label: 'Fast-fail', className: 'task-pill__fail--fastfail' }
  if (task.pr_url || task.pr_status === 'branch_only') return { icon: GitBranch, label: 'Push failed', className: 'task-pill__fail--push' }
  if (task.status === 'cancelled') return { icon: Slash, label: 'Cancelled', className: 'task-pill__fail--cancelled' }
  return { icon: XCircle, label: 'Agent failed', className: 'task-pill__fail--agent' }
}

export function TaskPill({ task, selected, multiSelected, onClick }: TaskPillProps) {
  const [elapsed, setElapsed] = useState('')
  const [arriving, setArriving] = useState(false)
  const prevStatusRef = useRef(task.status)

  useEffect(() => {
    if (task.status !== prevStatusRef.current) {
      prevStatusRef.current = task.status
      setArriving(true)
      const timer = setTimeout(() => setArriving(false), 500)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [task.status])

  useEffect(() => {
    if (task.status !== 'active' || !task.started_at) return
    setElapsed(formatElapsed(task.started_at))
    const interval = setInterval(() => setElapsed(formatElapsed(task.started_at!)), 10000)
    return () => clearInterval(interval)
  }, [task.status, task.started_at])

  const isZombie = task.status === 'active' && (!!task.pr_url || !!task.pr_status)
  const isStale = task.status === 'active' && !!task.started_at &&
    (Date.now() - new Date(task.started_at).getTime() > (task.max_runtime_ms ?? 3600000))
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

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      useSprintUI.getState().toggleTaskSelection(task.id)
    } else if (e.metaKey || e.ctrlKey) {
      useSprintUI.getState().toggleTaskSelection(task.id)
    } else {
      useSprintUI.getState().clearSelection()
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
          onClick(task.id)
        }
      }}
      transition={SPRINGS.default}
      data-testid="task-pill"
    >
      <div className="task-pill__dot" style={{ background: getDotColor(task.status, task.pr_status) }} />
      {failureInfo && <span title={failureInfo.label}><failureInfo.icon size={10} className={failureInfo.className} aria-label={failureInfo.label} /></span>}
      {isZombie && <span title="Agent finished but task not marked done"><AlertTriangle size={12} className="task-pill__zombie-icon" aria-label="Zombie task" /></span>}
      {isStale && !isZombie && <span title="Task may be stuck"><Clock size={12} className="task-pill__stale-icon" aria-label="Stale task" /></span>}
      <span className="task-pill__title" title={task.title}>{task.title}</span>
      <span
        className="task-pill__badge"
        style={{ background: 'var(--neon-cyan-surface)', color: 'var(--neon-cyan)' }}
      >
        {task.repo}
      </span>
      {elapsed && <span className="task-pill__time">{elapsed}</span>}
      {task.status === 'done' && task.started_at && task.completed_at && (
        <span className="task-pill__duration">
          {formatDuration(task.started_at, task.completed_at)}
        </span>
      )}
      {task.status === 'active' && !isZombie && (
        <span className="task-pill__activity" />
      )}
    </motion.div>
  )
}
