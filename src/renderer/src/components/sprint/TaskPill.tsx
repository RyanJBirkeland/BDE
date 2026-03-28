import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { SprintTask } from '../../../../shared/types'
import { SPRINGS } from '../../lib/motion'

interface TaskPillProps {
  task: SprintTask
  selected: boolean
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

function getDotColor(status: string): string {
  switch (status) {
    case 'queued':
      return 'var(--neon-cyan)'
    case 'blocked':
      return 'var(--neon-orange)'
    case 'active':
      return 'var(--neon-purple)'
    case 'done':
      return 'var(--neon-pink)'
    default:
      return 'var(--neon-cyan)'
  }
}

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

export function TaskPill({ task, selected, onClick }: TaskPillProps) {
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    if (task.status !== 'active' || !task.started_at) return
    setElapsed(formatElapsed(task.started_at))
    const interval = setInterval(() => setElapsed(formatElapsed(task.started_at!)), 10000)
    return () => clearInterval(interval)
  }, [task.status, task.started_at])

  const statusClass = getStatusClass(task.status, task.pr_status)
  const classes = ['task-pill', statusClass, selected ? 'task-pill--selected' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <motion.div
      layoutId={task.id}
      className={classes}
      onClick={() => onClick(task.id)}
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
      <div className="task-pill__dot" style={{ background: getDotColor(task.status) }} />
      <span className="task-pill__title">{task.title}</span>
      <span
        className="task-pill__badge"
        style={{ background: 'var(--neon-cyan-surface)', color: 'var(--neon-cyan)' }}
      >
        {task.repo}
      </span>
      {elapsed && <span className="task-pill__time">{elapsed}</span>}
    </motion.div>
  )
}
