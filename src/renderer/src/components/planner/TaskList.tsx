import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Edit2 } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'
import { TERMINAL_STATUSES } from '../../../../shared/task-statuses'
import { STATUS_METADATA } from '../../lib/task-status-ui'
import { LoadingState } from '../ui/LoadingState'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { TaskRow } from './TaskRow'

export interface TaskListProps {
  tasks: SprintTask[]
  editingTaskId: string | null
  editingSpec: string
  saving: boolean
  loading: boolean
  onEditStart: (task: SprintTask) => void
  onCancelEdit: () => void
  onSaveEdit: () => Promise<void>
  onEditTask: (taskId: string) => void
  onAddTask: () => void
  onReorderTasks?: ((orderedTaskIds: string[]) => void) | undefined
  onSpecChange: (spec: string) => void
}

export function TaskList({
  tasks,
  editingTaskId,
  editingSpec,
  saving,
  loading,
  onEditStart,
  onCancelEdit,
  onSaveEdit,
  onEditTask,
  onAddTask,
  onReorderTasks,
  onSpecChange
}: TaskListProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null)

  const outstandingTasks = useMemo(
    () => tasks.filter((t) => !TERMINAL_STATUSES.has(t.status)),
    [tasks]
  )
  const completedTasks = useMemo(
    () => tasks.filter((t) => TERMINAL_STATUSES.has(t.status)),
    [tasks]
  )

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, taskId: string): void => {
    setDraggedTaskId(taskId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', taskId)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, taskId: string): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedTaskId && draggedTaskId !== taskId) {
      setDragOverTaskId(taskId)
    }
  }

  const handleDragLeave = (): void => {
    setDragOverTaskId(null)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetTaskId: string): void => {
    e.preventDefault()
    setDragOverTaskId(null)

    if (!draggedTaskId || draggedTaskId === targetTaskId || !onReorderTasks) return

    const draggedIndex = tasks.findIndex((t) => t.id === draggedTaskId)
    const targetIndex = tasks.findIndex((t) => t.id === targetTaskId)

    if (draggedIndex === -1 || targetIndex === -1) return

    // Reorder the task list
    const reordered = [...tasks]
    const [removed] = reordered.splice(draggedIndex, 1)
    if (!removed) return
    reordered.splice(targetIndex, 0, removed)

    // Call the reorder callback with new order
    onReorderTasks(reordered.map((t) => t.id))
  }

  const handleDragEnd = (): void => {
    setDraggedTaskId(null)
    setDragOverTaskId(null)
  }

  return (
    <motion.div
      className="epic-detail__tasks"
      variants={VARIANTS.staggerContainer}
      initial="initial"
      animate="animate"
    >
      {loading ? (
        <LoadingState message="Loading tasks..." />
      ) : (
        <>
          {outstandingTasks.map((task) => {
            const isDragging = draggedTaskId === task.id
            const isDragOver = dragOverTaskId === task.id
            const isEditing = editingTaskId === task.id

            return (
              <motion.div
                key={task.id}
                variants={VARIANTS.staggerChild}
                transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
              >
                <TaskRow
                  task={task}
                  isEditing={isEditing}
                  editingSpec={editingSpec}
                  saving={saving}
                  isDragging={isDragging}
                  isDragOver={isDragOver}
                  onEditStart={onEditStart}
                  onCancelEdit={onCancelEdit}
                  onSaveEdit={onSaveEdit}
                  onEdit={onEditTask}
                  onSpecChange={onSpecChange}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                />
              </motion.div>
            )
          })}

          <button type="button" className="epic-detail__add-task-row" onClick={onAddTask}>
            + Add task
          </button>

          {/* Completed tasks section */}
          {completedTasks.length > 0 && (
            <div className="epic-detail__completed-section">
              <div className="epic-detail__completed-divider">
                <div className="epic-detail__completed-divider-line" />
                <span className="epic-detail__completed-divider-label">
                  Completed ({completedTasks.length})
                </span>
                <div className="epic-detail__completed-divider-line" />
              </div>
              {completedTasks.map((task) => {
                const hasDeps = task.depends_on && task.depends_on.length > 0
                return (
                  <motion.div
                    key={task.id}
                    variants={VARIANTS.staggerChild}
                    transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
                  >
                    <div className="epic-detail__task-row epic-detail__task-row--completed">
                      <div
                        className="epic-detail__task-status-dot"
                        style={{
                          background: `var(${STATUS_METADATA[task.status].colorToken})`
                        }}
                      />
                      <span className="epic-detail__task-title">{task.title}</span>
                      {hasDeps && task.depends_on && (
                        <span className="epic-detail__task-dep-ref">
                          {task.depends_on.length} dep{task.depends_on.length === 1 ? '' : 's'}
                        </span>
                      )}
                      <span
                        className="epic-detail__task-status-badge"
                        style={{
                          color: `var(${STATUS_METADATA[task.status].colorToken})`
                        }}
                      >
                        {STATUS_METADATA[task.status].label}
                      </span>
                      <button
                        type="button"
                        className="epic-detail__task-edit-btn"
                        onClick={() => onEditTask(task.id)}
                        aria-label={`Edit ${task.title}`}
                      >
                        <Edit2 size={14} />
                      </button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}
