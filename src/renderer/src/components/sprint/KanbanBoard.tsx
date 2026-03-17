import { useState, useMemo } from 'react'
import { LayoutGroup } from 'framer-motion'
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { KanbanColumn } from './KanbanColumn'
import { TaskCard } from './TaskCard'
import type { SprintTask } from './SprintCenter'

type KanbanBoardProps = {
  tasks: SprintTask[]
  prMergedMap: Record<string, boolean>
  onDragEnd: (taskId: string, newStatus: SprintTask['status']) => void
  onReorder?: (status: SprintTask['status'], orderedIds: string[]) => void
  onPushToSprint: (task: SprintTask) => void
  onLaunch: (task: SprintTask) => void
  onViewSpec: (task: SprintTask) => void
  onViewOutput: (task: SprintTask) => void
}

const VALID_STATUSES: SprintTask['status'][] = ['backlog', 'queued', 'active', 'done']

function resolveTargetStatus(
  overId: string,
  tasks: SprintTask[]
): SprintTask['status'] | null {
  if (VALID_STATUSES.includes(overId as SprintTask['status'])) {
    return overId as SprintTask['status']
  }
  const targetTask = tasks.find((t) => t.id === overId)
  return targetTask?.status ?? null
}

export function KanbanBoard({
  tasks,
  prMergedMap,
  onDragEnd,
  onReorder,
  onPushToSprint,
  onLaunch,
  onViewSpec,
  onViewOutput,
}: KanbanBoardProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [activeTask, setActiveTask] = useState<SprintTask | null>(null)

  const backlog = useMemo(() => tasks.filter((t) => t.status === 'backlog'), [tasks])
  const queued = useMemo(() => tasks.filter((t) => t.status === 'queued'), [tasks])
  const active = useMemo(() => tasks.filter((t) => t.status === 'active'), [tasks])
  const done = useMemo(() => tasks.filter((t) => t.status === 'done'), [tasks])

  const columnsByStatus: Record<SprintTask['status'], SprintTask[]> = {
    backlog,
    queued,
    active,
    done,
  }

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === String(event.active.id)) ?? null
    setActiveTask(task)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null)
    const { active: dragActive, over } = event
    if (!over) return

    const taskId = String(dragActive.id)
    const targetStatus = resolveTargetStatus(String(over.id), tasks)
    if (!targetStatus) return

    const sourceTask = tasks.find((t) => t.id === taskId)
    if (!sourceTask) return

    if (sourceTask.status === targetStatus) {
      // Within-column reorder
      if (onReorder && over.id !== targetStatus) {
        const column = columnsByStatus[targetStatus]
        const oldIndex = column.findIndex((t) => t.id === taskId)
        const newIndex = column.findIndex((t) => t.id === String(over.id))
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const reordered = arrayMove(column, oldIndex, newIndex)
          onReorder(targetStatus, reordered.map((t) => t.id))
        }
      }
      return
    }

    onDragEnd(taskId, targetStatus)
  }

  const noop = () => {}

  return (
    <LayoutGroup>
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
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
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            index={0}
            prMerged={prMergedMap[activeTask.id] ?? false}
            onPushToSprint={noop}
            onLaunch={noop}
            onViewSpec={noop}
            onViewOutput={noop}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
    </LayoutGroup>
  )
}
