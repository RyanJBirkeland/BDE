import { memo, useState } from 'react'
import { motion } from 'framer-motion'
import type { SprintTask } from '../../../../shared/types'
import { SPRINGS } from '../../lib/motion'
import { formatElapsed } from '../../lib/task-format'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'
import { useSprintSelection } from '../../stores/sprintSelection'
import { StatusDot } from '../ui/StatusDot'
import type { StatusDotKind } from '../ui/StatusDot'
import { PriorityChip } from './primitives/PriorityChip'

interface TaskRowV2Props {
  task: SprintTask
  selected: boolean
  onClick: (id: string) => void
}

function statusToDotKind(status: string, prStatus?: string | null): StatusDotKind {
  if (prStatus === 'open' || prStatus === 'branch_only') return 'review'
  if (status === 'active') return 'running'
  if (status === 'blocked') return 'blocked'
  if (status === 'review' || status === 'approved') return 'review'
  if (status === 'done') return 'done'
  if (status === 'failed' || status === 'error' || status === 'cancelled') return 'failed'
  return 'queued'
}

function TaskRowV2Inner({ task, selected, onClick }: TaskRowV2Props): React.JSX.Element {
  const [, setTick] = useState(0)

  const isActive = task.status === 'active' && !!task.started_at
  useBackoffInterval(() => setTick((t) => t + 1), isActive ? 10_000 : null)

  const elapsed = isActive ? formatElapsed(task.started_at!) : ''

  const handleClick = (): void => {
    useSprintSelection.getState().clearSelection()
    onClick(task.id)
  }

  return (
    <motion.div
      layoutId={task.id}
      role="button"
      tabIndex={0}
      aria-label={`Task: ${task.title}, status: ${task.status}`}
      data-testid="task-row"
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(task.id)
        }
      }}
      transition={SPRINGS.default}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-2)',
        padding: 'var(--s-1) var(--s-2)',
        height: 28,
        background: selected ? 'var(--surf-2)' : 'transparent',
        border: selected ? '1px solid var(--line-2)' : '1px solid transparent',
        borderRadius: 5,
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      <StatusDot kind={statusToDotKind(task.status, task.pr_status)} size={6} />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--fg-4)',
          flexShrink: 0,
        }}
      >
        {task.id.substring(0, 8)}
      </span>
      <span
        style={{
          fontSize: 11,
          color: 'var(--fg)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {task.title}
      </span>
      <PriorityChip priority={task.priority ?? 3} />
      {isActive && elapsed && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--fg-3)',
            flexShrink: 0,
          }}
        >
          {elapsed}
        </span>
      )}
    </motion.div>
  )
}

export const TaskRowV2 = memo(TaskRowV2Inner)
TaskRowV2.displayName = 'TaskRowV2'
