import { memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { AgentStatusChip } from './AgentStatusChip'
import { TaskEventSubtitle } from './TaskEventSubtitle'
import { repoBadgeVariant } from '../../lib/format'
import { useSprintEvents } from '../../stores/sprintEvents'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintUI } from '../../stores/sprintUI'

import { TASK_STATUS } from '../../../../shared/constants'
import type { SprintTask } from './SprintCenter'

type TaskCardProps = {
  task: SprintTask
  index: number
  prMerged: boolean
  isGenerating?: boolean
  onPushToSprint: (task: SprintTask) => void
  onLaunch: (task: SprintTask) => void
  onViewSpec: (task: SprintTask) => void
  onViewOutput: (task: SprintTask) => void
  onMarkDone?: (task: SprintTask) => void
  onStop?: (task: SprintTask) => void
}

export const TaskCard = memo(function TaskCard({
  task,
  index,
  prMerged,
  isGenerating,
  onPushToSprint,
  onLaunch,
  onViewSpec,
  onViewOutput,
  onMarkDone,
  onStop,
}: TaskCardProps) {
  const latestEvent = useSprintEvents((s) => s.latestEvents[task.id] ?? null)
  const allTasks = useSprintTasks((s) => s.tasks)
  const selectedTaskIds = useSprintUI((s) => s.selectedTaskIds)
  const toggleTaskSelection = useSprintUI((s) => s.toggleTaskSelection)
  const hasAnySelection = selectedTaskIds.length > 0
  const isSelected = selectedTaskIds.includes(task.id)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  })

  // Override dnd-kit's default aria-roledescription with a more descriptive label
  const sortableAttributes = { ...attributes, 'aria-roledescription': 'sortable task' }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    '--stagger-index': index,
  } as React.CSSProperties

  const isHighPriority = task.priority <= 2

  const className = [
    'task-card',
    isDragging && 'task-card--dragging',
    isHighPriority && 'task-card--high-priority',
    task.status === 'blocked' && 'task-card--blocked',
    isSelected && 'task-card--selected',
  ]
    .filter(Boolean)
    .join(' ')

  // Get blocker tasks for blocked status
  const blockerTasks =
    task.status === 'blocked' && task.depends_on
      ? task.depends_on
          .map((dep) => allTasks.find((t) => t.id === dep.id))
          .filter((t): t is SprintTask => t !== undefined)
      : []

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleTaskSelection(task.id)
  }

  return (
    <div ref={setNodeRef} style={style} className={className} {...sortableAttributes} {...listeners}>
      {hasAnySelection && (
        <input
          type="checkbox"
          className="task-card__checkbox"
          checked={isSelected}
          onClick={handleCheckboxClick}
          onChange={() => {}}
          aria-label={`Select task ${task.title}`}
        />
      )}
      <div className="task-card__title" title={task.title}>
        {task.title}
      </div>
      {blockerTasks.length > 0 && (
        <div className="task-card__blocker-label">
          Blocked by: {blockerTasks.map((t) => t.title).join(', ')}
        </div>
      )}
      {task.depends_on && task.depends_on.length > 0 && (
        <div className="task-card__deps">
          {task.depends_on.map((dep) => (
            <span
              key={dep.id}
              className={`task-card__dep-chip ${dep.type === 'hard' ? 'task-card__dep-chip--hard' : ''}`}
            >
              {dep.type === 'hard' ? '●' : '○'} {dep.id.slice(0, 8)}
            </span>
          ))}
        </div>
      )}
      {isGenerating && (
        <span className="task-card__spec-badge task-card__spec-badge--generating">
          Writing spec...
        </span>
      )}
      <div className="task-card__badges">
        {isHighPriority && (
          <Badge variant={task.priority <= 1 ? 'danger' : 'warning'} size="sm">
            P{task.priority}
          </Badge>
        )}
        <Badge variant={repoBadgeVariant(task.repo)} size="sm">
          {task.repo}
        </Badge>
        {task.spec && (
          <span className="task-card__spec-dot" title="Has spec">
            📄
          </span>
        )}
        {task.pr_url && (
          <a
            href={task.pr_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ textDecoration: 'none' }}
          >
            <Badge variant={prMerged ? 'success' : 'warning'} size="sm">
              {prMerged ? 'Merged' : 'PR Open'}
            </Badge>
          </a>
        )}
        {task.pr_url && task.pr_mergeable_state === 'dirty' && !prMerged && (
          <Badge variant="danger" size="sm">Conflict</Badge>
        )}
        {task.status === 'blocked' && (
          <Badge variant="warning">Blocked</Badge>
        )}
      </div>

      {task.status === TASK_STATUS.ACTIVE && (
        <>
          <AgentStatusChip status="running" startedAt={task.started_at} />
          <TaskEventSubtitle event={latestEvent} />
        </>
      )}

      <div className="task-card__actions">
        {task.status === TASK_STATUS.BACKLOG && (
          <>
            <Button variant="primary" size="sm" onClick={() => onPushToSprint(task)}>
              → Sprint
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onViewSpec(task)}>
              Spec
            </Button>
          </>
        )}
        {task.status === TASK_STATUS.QUEUED && (
          <>
            <Button variant="primary" size="sm" onClick={() => onLaunch(task)}>
              Launch
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onViewSpec(task)}>
              Spec
            </Button>
            {onMarkDone && (
              <Button variant="ghost" size="sm" onClick={() => onMarkDone(task)}>
                ✓ Done
              </Button>
            )}
          </>
        )}
        {task.status === TASK_STATUS.BLOCKED && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              window.api?.sprint?.unblockTask?.(task.id).catch((err: unknown) => {
                console.error('[TaskCard] unblockTask failed:', err)
              })
            }}
          >
            Unblock
          </Button>
        )}
        {task.status === TASK_STATUS.ACTIVE && (
          <>
            <Button variant="ghost" size="sm" onClick={() => onViewOutput(task)}>
              View Output
            </Button>
            {onMarkDone && (
              <Button variant="ghost" size="sm" onClick={() => onMarkDone(task)}>
                ✓ Done
              </Button>
            )}
            {onStop && (
              <Button variant="danger" size="sm" onClick={() => onStop(task)}>
                Stop
              </Button>
            )}
          </>
        )}
        {task.status === TASK_STATUS.DONE && (
          <>
            {task.pr_url && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.api.openExternal(task.pr_url!)}
              >
                PR #{task.pr_number}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => onViewOutput(task)}>
              View Output
            </Button>
          </>
        )}
      </div>
    </div>
  )
})
