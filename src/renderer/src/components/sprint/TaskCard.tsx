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
  onPushToSprint: (task: SprintTask) => void
  onLaunch: (task: SprintTask) => void
  onViewSpec: (task: SprintTask) => void
  onViewOutput: (task: SprintTask) => void
}

function repoBadgeVariant(repo: string): 'info' | 'warning' | 'success' | 'default' {
  const lower = repo.toLowerCase()
  if (lower === 'bde') return 'info'
  if (lower === 'feast') return 'warning'
  if (lower === 'life-os') return 'success'
  return 'default'
}

export function TaskCard({
  task,
  index,
  prMerged,
  onPushToSprint,
  onLaunch,
  onViewSpec,
  onViewOutput,
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

  const className = ['task-card', isDragging && 'task-card--dragging'].filter(Boolean).join(' ')

  return (
    <div ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
      <div className="task-card__title">{task.title}</div>
      <div className="task-card__badges">
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
          </>
        )}
        {task.status === 'active' && (
          <Button variant="ghost" size="sm" onClick={() => onViewOutput(task)}>
            View Output
          </Button>
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
}
