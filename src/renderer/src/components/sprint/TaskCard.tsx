import { memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { AgentStatusChip } from './AgentStatusChip'

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

function repoBadgeVariant(repo: string): 'info' | 'warning' | 'success' | 'default' {
  const lower = repo.toLowerCase()
  if (lower === 'bde') return 'info'
  if (lower === 'feast') return 'warning'
  if (lower === 'life-os') return 'success'
  return 'default'
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  })

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
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
      <div className="task-card__title" title={task.title}>
        {task.title}
      </div>
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
      </div>

      {task.status === 'active' && (
        <AgentStatusChip status="running" startedAt={task.started_at} />
      )}

      <div className="task-card__actions">
        {task.status === 'backlog' && (
          <>
            <Button variant="primary" size="sm" onClick={() => onPushToSprint(task)}>
              → Sprint
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onViewSpec(task)}>
              Spec
            </Button>
          </>
        )}
        {task.status === 'queued' && (
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
        {task.status === 'active' && (
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
        {task.status === 'done' && (
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
