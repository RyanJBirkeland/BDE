import { useState, useCallback } from 'react'
import { LayoutGroup } from 'framer-motion'
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { KanbanColumn } from './KanbanColumn'
import { TaskCard } from './TaskCard'
import { ConfirmModal } from '../ui/ConfirmModal'
import { WIP_LIMIT_IN_PROGRESS } from '../../lib/constants'
import { TASK_STATUS } from '../../../../shared/constants'
import { toast } from '../../stores/toasts'
import type { SprintTask } from './SprintCenter'

type KanbanBoardProps = {
  todoTasks: SprintTask[]
  activeTasks: SprintTask[]
  awaitingReviewTasks: SprintTask[]
  prMergedMap: Record<string, boolean>
  generatingIds?: string[]
  onDragEnd: (taskId: string, newStatus: SprintTask['status']) => void
  onReorder?: (status: SprintTask['status'], orderedIds: string[]) => void
  onPushToSprint: (task: SprintTask) => void
  onLaunch: (task: SprintTask) => void
  onViewSpec: (task: SprintTask) => void
  onViewOutput: (task: SprintTask) => void
  onMarkDone?: (task: SprintTask) => void
  onStop?: (task: SprintTask) => void
}

const VALID_STATUSES: SprintTask['status'][] = [TASK_STATUS.QUEUED, TASK_STATUS.ACTIVE]

function resolveTargetStatus(overId: string, allTasks: SprintTask[]): SprintTask['status'] | null {
  if (VALID_STATUSES.includes(overId as SprintTask['status'])) {
    return overId as SprintTask['status']
  }
  const targetTask = allTasks.find((t) => t.id === overId)
  if (!targetTask) return null
  // Only allow drops into queued or active columns
  if (VALID_STATUSES.includes(targetTask.status)) return targetTask.status
  return null
}

const EMPTY_ARRAY: string[] = []

export function KanbanBoard({
  todoTasks,
  activeTasks,
  awaitingReviewTasks,
  prMergedMap,
  generatingIds = EMPTY_ARRAY,
  onDragEnd,
  onReorder,
  onPushToSprint,
  onLaunch,
  onViewSpec,
  onViewOutput,
  onMarkDone,
  onStop
}: KanbanBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const [activeTask, setActiveTask] = useState<SprintTask | null>(null)
  const [pendingDrag, setPendingDrag] = useState<{
    taskId: string
    targetStatus: SprintTask['status']
  } | null>(null)

  const wipFull = activeTasks.length >= WIP_LIMIT_IN_PROGRESS

  // All draggable tasks (only queued + active participate in DnD)
  const draggableTasks = [...todoTasks, ...activeTasks]

  const columnsByStatus: Partial<Record<SprintTask['status'], SprintTask[]>> = {
    queued: todoTasks,
    active: activeTasks
  }

  const handleDragStart = (event: DragStartEvent) => {
    const task = draggableTasks.find((t) => t.id === String(event.active.id)) ?? null
    setActiveTask(task)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null)
    const { active: dragActive, over } = event
    if (!over) return

    const taskId = String(dragActive.id)
    const targetStatus = resolveTargetStatus(String(over.id), draggableTasks)
    if (!targetStatus) return

    const sourceTask = draggableTasks.find((t) => t.id === taskId)
    if (!sourceTask) return

    // Block drops into In Progress when WIP limit is reached
    if (
      targetStatus === TASK_STATUS.ACTIVE &&
      sourceTask.status !== TASK_STATUS.ACTIVE &&
      wipFull
    ) {
      toast.info(
        `WIP limit reached (${WIP_LIMIT_IN_PROGRESS}/${WIP_LIMIT_IN_PROGRESS}). Complete or remove an in-progress task first.`
      )
      return
    }

    if (sourceTask.status === targetStatus) {
      // Within-column reorder
      if (onReorder && over.id !== targetStatus) {
        const column = columnsByStatus[targetStatus]
        if (column) {
          const oldIndex = column.findIndex((t) => t.id === taskId)
          const newIndex = column.findIndex((t) => t.id === String(over.id))
          if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
            const reordered = arrayMove(column, oldIndex, newIndex)
            onReorder(
              targetStatus,
              reordered.map((t) => t.id)
            )
          }
        }
      }
      return
    }

    // Guard: active->queued requires confirmation
    if (sourceTask.status === TASK_STATUS.ACTIVE && targetStatus === TASK_STATUS.QUEUED) {
      setPendingDrag({ taskId, targetStatus })
      return
    }

    onDragEnd(taskId, targetStatus)
  }

  const handleConfirmDrag = useCallback(() => {
    if (pendingDrag) {
      onDragEnd(pendingDrag.taskId, pendingDrag.targetStatus)
      setPendingDrag(null)
    }
  }, [pendingDrag, onDragEnd])

  const handleCancelDrag = useCallback(() => {
    setPendingDrag(null)
  }, [])

  const noop = () => {}

  return (
    <>
      <ConfirmModal
        open={pendingDrag !== null}
        message="Move back to queue? This won't stop the running agent."
        confirmLabel="Move to Queue"
        onConfirm={handleConfirmDrag}
        onCancel={handleCancelDrag}
      />
      <LayoutGroup>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="kanban-board">
            <KanbanColumn
              status="queued"
              label="To Do"
              tasks={todoTasks}
              prMergedMap={prMergedMap}
              generatingIds={generatingIds}
              onPushToSprint={onPushToSprint}
              onLaunch={onLaunch}
              onViewSpec={onViewSpec}
              onViewOutput={onViewOutput}
              onMarkDone={onMarkDone}
              onStop={onStop}
            />
            <KanbanColumn
              status="active"
              label="In Progress"
              tasks={activeTasks}
              prMergedMap={prMergedMap}
              generatingIds={generatingIds}
              wipLimit={WIP_LIMIT_IN_PROGRESS}
              onPushToSprint={onPushToSprint}
              onLaunch={onLaunch}
              onViewSpec={onViewSpec}
              onViewOutput={onViewOutput}
              onMarkDone={onMarkDone}
              onStop={onStop}
            />
            <KanbanColumn
              status="review"
              label="Awaiting Review"
              tasks={awaitingReviewTasks}
              prMergedMap={prMergedMap}
              generatingIds={generatingIds}
              readOnly
              onPushToSprint={onPushToSprint}
              onLaunch={onLaunch}
              onViewSpec={onViewSpec}
              onViewOutput={onViewOutput}
              onMarkDone={onMarkDone}
              onStop={onStop}
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
    </>
  )
}
