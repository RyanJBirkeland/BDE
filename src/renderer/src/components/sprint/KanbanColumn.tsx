import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { TaskCard } from './TaskCard'
import { EmptyState } from '../ui/EmptyState'
import type { SprintTask } from './SprintCenter'

type KanbanColumnProps = {
  status: SprintTask['status']
  label: string
  tasks: SprintTask[]
  prMergedMap: Record<string, boolean>
  onPushToSprint: (task: SprintTask) => void
  onLaunch: (task: SprintTask) => void
  onViewSpec: (task: SprintTask) => void
  onViewOutput: (task: SprintTask) => void
}

const EMPTY_LABELS: Record<SprintTask['status'], string> = {
  backlog: 'Backlog is empty',
  queued: 'Sprint queue is empty',
  active: 'Nothing in progress',
  done: 'No completed tasks yet',
}

const STATUS_CLASS: Record<SprintTask['status'], string> = {
  backlog: 'kanban-col--backlog',
  queued: 'kanban-col--sprint',
  active: 'kanban-col--active',
  done: 'kanban-col--done',
}

export function KanbanColumn({
  status,
  label,
  tasks,
  prMergedMap,
  onPushToSprint,
  onLaunch,
  onViewSpec,
  onViewOutput,
}: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: status })
  const ids = tasks.map((t) => t.id)

  return (
    <div
      ref={setNodeRef}
      className={`kanban-col ${STATUS_CLASS[status]} ${isOver ? 'kanban-col--drop-target' : ''}`}
    >
      <div className="kanban-col__header">
        {label}
        <span className="sprint-col__count bde-count-badge">{tasks.length}</span>
      </div>
      <div className="kanban-col__cards">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? (
            <EmptyState title={EMPTY_LABELS[status]} />
          ) : (
            tasks.map((task, i) => (
              <TaskCard
                key={task.id}
                task={task}
                index={i}
                prMerged={prMergedMap[task.id] ?? false}
                onPushToSprint={onPushToSprint}
                onLaunch={onLaunch}
                onViewSpec={onViewSpec}
                onViewOutput={onViewOutput}
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  )
}
