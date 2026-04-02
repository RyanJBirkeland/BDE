import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { SprintTask } from '../../../../shared/types'
import { SPRINGS } from '../../lib/motion'
import { formatElapsed, getDotColor } from '../../lib/task-format'

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

export function TaskPill({ task, selected, onClick }: TaskPillProps) {
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

  const statusClass = getStatusClass(task.status, task.pr_status)
  const classes = [
    'task-pill',
    statusClass,
    selected ? 'task-pill--selected' : '',
    arriving ? 'task-pill--arriving' : ''
  ]
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
      <span className="task-pill__title" title={task.title}>{task.title}</span>
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
