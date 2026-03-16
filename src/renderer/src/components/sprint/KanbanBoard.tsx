import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { KanbanColumn } from './KanbanColumn'
import type { SprintTask } from './SprintCenter'

type KanbanBoardProps = {
  tasks: SprintTask[]
  prMergedMap: Record<string, boolean>
  onDragEnd: (taskId: string, newStatus: SprintTask['status']) => void
  onPushToSprint: (task: SprintTask) => void
  onLaunch: (task: SprintTask) => void
  onViewSpec: (task: SprintTask) => void
  onViewOutput: (task: SprintTask) => void
}

const VALID_STATUSES: SprintTask['status'][] = ['backlog', 'queued', 'active', 'done']

export function KanbanBoard({
  tasks,
  prMergedMap,
  onDragEnd,
  onPushToSprint,
  onLaunch,
  onViewSpec,
  onViewOutput,
}: KanbanBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const backlog = tasks.filter((t) => t.status === 'backlog')
  const queued = tasks.filter((t) => t.status === 'queued')
  const active = tasks.filter((t) => t.status === 'active')
  const done = tasks.filter((t) => t.status === 'done')

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const taskId = String(active.id)
    const destinationStatus = String(over.id) as SprintTask['status']
    if (VALID_STATUSES.includes(destinationStatus)) {
      onDragEnd(taskId, destinationStatus)
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="kanban-board">
        <KanbanColumn
          status="backlog"
          label="Backlog"
          tasks={backlog}
          prMergedMap={prMergedMap}
          onPushToSprint={onPushToSprint}
          onLaunch={onLaunch}
          onViewSpec={onViewSpec}
          onViewOutput={onViewOutput}
        />
        <KanbanColumn
          status="queued"
          label="Sprint"
          tasks={queued}
          prMergedMap={prMergedMap}
          onPushToSprint={onPushToSprint}
          onLaunch={onLaunch}
          onViewSpec={onViewSpec}
          onViewOutput={onViewOutput}
        />
        <KanbanColumn
          status="active"
          label="In Progress"
          tasks={active}
          prMergedMap={prMergedMap}
          onPushToSprint={onPushToSprint}
          onLaunch={onLaunch}
          onViewSpec={onViewSpec}
          onViewOutput={onViewOutput}
        />
        <KanbanColumn
          status="done"
          label="Done"
          tasks={done}
          prMergedMap={prMergedMap}
          onPushToSprint={onPushToSprint}
          onLaunch={onLaunch}
          onViewSpec={onViewSpec}
          onViewOutput={onViewOutput}
        />
      </div>
    </DndContext>
  )
}
