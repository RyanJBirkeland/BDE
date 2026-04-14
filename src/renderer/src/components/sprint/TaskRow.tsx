import { useState, memo } from 'react'
import { motion } from 'framer-motion'
import type { SprintTask } from '../../../../shared/types'
import { SPRINGS } from '../../lib/motion'
import { formatElapsed, getDotColor } from '../../lib/task-format'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'
import { useSprintSelection } from '../../stores/sprintSelection'

import './TaskRow.css'

interface TaskRowProps {
  task: SprintTask
  selected: boolean
  onClick: (id: string) => void
}

function TaskRowInner({ task, selected, onClick }: TaskRowProps): React.JSX.Element {
  const [, setTick] = useState(0)

  // Trigger re-render every 10s for active tasks to update elapsed time
  const isActive = task.status === 'active' && !!task.started_at
  useBackoffInterval(() => setTick((t) => t + 1), isActive ? 10_000 : null)

  const elapsed = task.status === 'active' && task.started_at ? formatElapsed(task.started_at) : ''

  const handleClick = (): void => {
    useSprintSelection.getState().clearSelection()
    onClick(task.id)
  }

  return (
    <motion.div
      layoutId={task.id}
      className={`task-row${selected ? ' task-row--selected' : ''}`}
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
      data-testid="task-row"
    >
      <div
        className="task-row__dot"
        style={{ background: getDotColor(task.status, task.pr_status) }}
      />
      <span className="task-row__title" title={task.title}>
        {task.title}
      </span>
      <span className="task-row__repo">{task.repo}</span>
      {elapsed && <span className="task-row__time">{elapsed}</span>}
      {task.priority && (
        <span className="task-row__priority" data-priority={task.priority}>
          P{task.priority}
        </span>
      )}
    </motion.div>
  )
}

export const TaskRow = memo(TaskRowInner)
TaskRow.displayName = 'TaskRow'
