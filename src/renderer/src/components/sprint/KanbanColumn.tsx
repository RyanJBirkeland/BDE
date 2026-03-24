import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { memo } from 'react'
import { motion } from 'framer-motion'
import { TaskCard } from './TaskCard'
import { EmptyState } from '../ui/EmptyState'
import { SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import type { SprintTask } from './SprintCenter'

type ColumnStatus = SprintTask['status'] | 'review'

type KanbanColumnProps = {
  status: ColumnStatus
  label: string
  tasks: SprintTask[]
  prMergedMap: Record<string, boolean>
  generatingIds?: Set<string>
  readOnly?: boolean
  wipLimit?: number
  onPushToSprint: (task: SprintTask) => void
  onLaunch: (task: SprintTask) => void
  onViewSpec: (task: SprintTask) => void
  onViewOutput: (task: SprintTask) => void
  onMarkDone?: (task: SprintTask) => void
  onStop?: (task: SprintTask) => void
}

const EMPTY_LABELS: Record<ColumnStatus, string> = {
  backlog: 'Backlog is empty',
  queued: 'Sprint queue is empty',
  active: 'Nothing in progress',
  done: 'No completed tasks yet',
  cancelled: 'No cancelled tasks',
  failed: 'No failed tasks',
  error: 'No errored tasks',
  blocked: 'No blocked tasks',
  review: 'No PRs awaiting review',
}

const STATUS_CLASS: Record<ColumnStatus, string> = {
  backlog: 'kanban-col--backlog',
  queued: 'kanban-col--sprint',
  active: 'kanban-col--active',
  done: 'kanban-col--done',
  cancelled: 'kanban-col--done',
  failed: 'kanban-col--done',
  error: 'kanban-col--done',
  blocked: 'kanban-col--blocked',
  review: 'kanban-col--review',
}

export const KanbanColumn = memo(function KanbanColumn({
  status,
  label,
  tasks,
  prMergedMap,
  generatingIds,
  readOnly = false,
  wipLimit,
  onPushToSprint,
  onLaunch,
  onViewSpec,
  onViewOutput,
  onMarkDone,
  onStop,
}: KanbanColumnProps) {
  const reduced = useReducedMotion()
  const wipFull = wipLimit !== undefined && tasks.length >= wipLimit
  const droppable = useDroppable({ id: status, disabled: readOnly || wipFull })
  const isOver = (readOnly || wipFull) ? false : droppable.isOver
  const setNodeRef = (readOnly || wipFull) ? undefined : droppable.setNodeRef
  const ids = tasks.map((t) => t.id)

  const renderTasks = () => {
    if (tasks.length === 0) {
      return (
        <div className="kanban-col__empty">
          <EmptyState title={EMPTY_LABELS[status]} />
          {!readOnly && <span className="kanban-col__drop-hint">Drop cards here</span>}
        </div>
      )
    }
    return tasks.map((task, i) => (
      <motion.div
        key={task.id}
        layoutId={reduced || tasks.length > 10 ? undefined : task.id}
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.default}
      >
        <TaskCard
          task={task}
          index={i}
          prMerged={prMergedMap[task.id] ?? false}
          isGenerating={!readOnly ? (generatingIds?.has(task.id) ?? false) : undefined}
          onPushToSprint={onPushToSprint}
          onLaunch={onLaunch}
          onViewSpec={onViewSpec}
          onViewOutput={onViewOutput}
          onMarkDone={onMarkDone}
          onStop={onStop}
        />
      </motion.div>
    ))
  }

  const content = (
    <div className="kanban-col__cards">
      {readOnly ? (
        renderTasks()
      ) : (
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {renderTasks()}
        </SortableContext>
      )}
    </div>
  )

  return (
    <div
      ref={setNodeRef}
      role="region"
      aria-label={`${label}, ${tasks.length} ${tasks.length === 1 ? 'item' : 'items'}`}
      className={`kanban-col ${STATUS_CLASS[status]} ${isOver ? 'kanban-col--drop-target' : ''} ${wipFull ? 'kanban-col--wip-full' : ''}`}
    >
      <div className="kanban-col__header">
        {label}
        {wipLimit !== undefined ? (
          <span className={`sprint-col__count bde-count-badge ${wipFull ? 'bde-count-badge--wip-full' : ''}`}>
            {tasks.length}/{wipLimit}
          </span>
        ) : (
          <span className="sprint-col__count bde-count-badge">{tasks.length}</span>
        )}
      </div>
      {content}
    </div>
  )
})
