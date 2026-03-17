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
  review: 'No PRs awaiting review',
}

const STATUS_CLASS: Record<ColumnStatus, string> = {
  backlog: 'kanban-col--backlog',
  queued: 'kanban-col--sprint',
  active: 'kanban-col--active',
  done: 'kanban-col--done',
  cancelled: 'kanban-col--done',
  review: 'kanban-col--review',
}

export const KanbanColumn = memo(function KanbanColumn({
  status,
  label,
  tasks,
  prMergedMap,
  generatingIds,
  readOnly = false,
  onPushToSprint,
  onLaunch,
  onViewSpec,
  onViewOutput,
  onMarkDone,
  onStop,
}: KanbanColumnProps) {
  const reduced = useReducedMotion()
  const droppable = useDroppable({ id: status, disabled: readOnly })
  const isOver = readOnly ? false : droppable.isOver
  const setNodeRef = readOnly ? undefined : droppable.setNodeRef
  const ids = tasks.map((t) => t.id)

  const content = (
    <div className="kanban-col__cards">
      {readOnly ? (
        tasks.length === 0 ? (
          <div className="kanban-col__empty">
            <EmptyState title={EMPTY_LABELS[status]} />
          </div>
        ) : (
          tasks.map((task, i) => (
            <motion.div
              key={task.id}
              layoutId={reduced || tasks.length > 10 ? undefined : task.id}
              transition={reduced ? REDUCED_TRANSITION : SPRINGS.default}
            >
              <TaskCard
                task={task}
                index={i}
                prMerged={prMergedMap[task.id] ?? false}
                onPushToSprint={onPushToSprint}
                onLaunch={onLaunch}
                onViewSpec={onViewSpec}
                onViewOutput={onViewOutput}
                onMarkDone={onMarkDone}
                onStop={onStop}
              />
            </motion.div>
          ))
        )
      ) : (
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? (
            <div className="kanban-col__empty">
              <EmptyState title={EMPTY_LABELS[status]} />
              <span className="kanban-col__drop-hint">Drop cards here</span>
            </div>
          ) : (
            tasks.map((task, i) => (
              <motion.div
                key={task.id}
                layoutId={reduced || tasks.length > 10 ? undefined : task.id}
                transition={reduced ? REDUCED_TRANSITION : SPRINGS.default}
              >
                <TaskCard
                  task={task}
                  index={i}
                  prMerged={prMergedMap[task.id] ?? false}
                  isGenerating={generatingIds?.has(task.id) ?? false}
                  onPushToSprint={onPushToSprint}
                  onLaunch={onLaunch}
                  onViewSpec={onViewSpec}
                  onViewOutput={onViewOutput}
                  onMarkDone={onMarkDone}
                />
              </motion.div>
            ))
          )}
        </SortableContext>
      )}
    </div>
  )

  return (
    <div
      ref={setNodeRef}
      className={`kanban-col ${STATUS_CLASS[status]} ${isOver ? 'kanban-col--drop-target' : ''}`}
    >
      <div className="kanban-col__header">
        {label}
        <span className="sprint-col__count bde-count-badge">{tasks.length}</span>
      </div>
      {content}
    </div>
  )
})
