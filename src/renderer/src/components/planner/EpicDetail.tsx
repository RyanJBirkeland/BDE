import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Edit2 } from 'lucide-react'
import type { TaskGroup, SprintTask, EpicDependency } from '../../../../shared/types'
import { STATUS_METADATA } from '../../lib/task-status-ui'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import { usePrompt, PromptModal } from '../ui/PromptModal'
import { LoadingState } from '../ui/LoadingState'
import { toast } from '../../stores/toasts'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { EpicDependencySection } from './EpicDependencySection'
import { EpicHeader } from './EpicHeader'
import { EpicProgress } from './EpicProgress'
import { TaskRow } from './TaskRow'
import './EpicDetail.css'

export interface EpicDetailProps {
  group: TaskGroup
  tasks: SprintTask[]
  allGroups: TaskGroup[]
  onAddDependency: (dep: EpicDependency) => Promise<void>
  onRemoveDependency: (upstreamId: string) => Promise<void>
  onUpdateDependencyCondition: (
    upstreamId: string,
    condition: EpicDependency['condition']
  ) => Promise<void>
  loading?: boolean
  onQueueAll: () => void
  onAddTask: () => void
  onEditTask: (taskId: string) => void
  onEditGroup?: (name: string, goal: string) => void
  onDeleteGroup?: () => void
  onToggleReady?: () => void
  onReorderTasks?: (orderedTaskIds: string[]) => void
  onMarkCompleted?: () => void
}

export function EpicDetail({
  group,
  tasks,
  allGroups,
  onAddDependency,
  onRemoveDependency,
  onUpdateDependencyCondition,
  loading = false,
  onQueueAll,
  onAddTask,
  onEditTask,
  onEditGroup,
  onDeleteGroup,
  onToggleReady,
  onReorderTasks,
  onMarkCompleted
}: EpicDetailProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingSpec, setEditingSpec] = useState('')
  const [saving, setSaving] = useState(false)
  const { confirm, confirmProps } = useConfirm()
  const { prompt, promptProps } = usePrompt()

  // Count tasks missing specs (backlog/draft tasks with no spec)
  const tasksNeedingSpecs = useMemo(() => {
    return tasks.filter((t) => t.status === 'backlog' && (!t.spec || t.spec.trim() === '')).length
  }, [tasks])

  // Count tasks ready to queue (backlog tasks WITH specs)
  const tasksReadyToQueue = useMemo(() => {
    return tasks.filter((t) => t.status === 'backlog' && t.spec && t.spec.trim() !== '').length
  }, [tasks])

  // Split tasks into outstanding vs completed for visual grouping
  const TERMINAL_STATUSES = new Set(['done', 'cancelled', 'failed', 'error'])
  const outstandingTasks = useMemo(
    () => tasks.filter((t) => !TERMINAL_STATUSES.has(t.status)),
    [tasks]
  )
  const completedTasks = useMemo(
    () => tasks.filter((t) => TERMINAL_STATUSES.has(t.status)),
    [tasks]
  )

  const isCompleted = group.status === 'completed'
  const queueDisabled = tasksNeedingSpecs > 0

  // Overflow menu handlers
  const handleEdit = async (): Promise<void> => {
    if (!onEditGroup) return
    const name = await prompt({
      message: 'Epic name:',
      title: 'Edit Epic',
      defaultValue: group.name,
      confirmLabel: 'Next'
    })
    if (name === null) return
    const goal = await prompt({
      message: 'Epic goal (optional):',
      title: 'Edit Epic',
      defaultValue: group.goal || '',
      confirmLabel: 'Save'
    })
    if (goal === null) return
    onEditGroup(name.trim(), goal.trim())
  }

  const handleDelete = async (): Promise<void> => {
    if (!onDeleteGroup) return
    const confirmed = await confirm({
      message: `Delete epic "${group.name}"? This cannot be undone.`,
      title: 'Delete Epic',
      confirmLabel: 'Delete',
      variant: 'danger'
    })
    if (confirmed) {
      onDeleteGroup()
    }
  }

  const handleToggleReady = (): void => {
    if (!onToggleReady) return
    onToggleReady()
  }

  const handleMarkCompleted = (): void => {
    if (!onMarkCompleted) return
    onMarkCompleted()
  }

  // Inline spec editing handlers
  const handleTaskClick = (task: SprintTask): void => {
    if (task.status !== 'backlog') return
    setEditingTaskId(task.id)
    setEditingSpec(task.spec || '')
  }

  const handleCancelEdit = (): void => {
    setEditingTaskId(null)
    setEditingSpec('')
  }

  const handleSaveEdit = async (): Promise<void> => {
    if (!editingTaskId) return
    setSaving(true)
    try {
      await window.api.sprint.update(editingTaskId, { spec: editingSpec })
      setEditingTaskId(null)
      setEditingSpec('')
    } catch (err) {
      console.error('Failed to update task spec:', err)
      toast.error('Failed to save spec. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const isReady = group.status === 'ready'

  // Drag and drop handlers
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
    reordered.splice(targetIndex, 0, removed)

    // Call the reorder callback with new order
    onReorderTasks(reordered.map((t) => t.id))
  }

  const handleDragEnd = (): void => {
    setDraggedTaskId(null)
    setDragOverTaskId(null)
  }

  return (
    <div className="bde-panel epic-detail">
      {/* Header */}
      <EpicHeader
        group={group}
        isReady={isReady}
        isCompleted={isCompleted}
        onEdit={handleEdit}
        onToggleReady={handleToggleReady}
        onMarkCompleted={handleMarkCompleted}
        onDelete={handleDelete}
      />

      {/* Progress Section */}
      <EpicProgress
        tasks={tasks}
        tasksNeedingSpecs={tasksNeedingSpecs}
        tasksReadyToQueue={tasksReadyToQueue}
      />

      {/* Epic Dependencies */}
      <EpicDependencySection
        group={group}
        allGroups={allGroups}
        onAddDependency={onAddDependency}
        onRemoveDependency={onRemoveDependency}
        onUpdateCondition={onUpdateDependencyCondition}
      />

      {/* Task List */}
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
                    onEditStart={handleTaskClick}
                    onCancelEdit={handleCancelEdit}
                    onSaveEdit={handleSaveEdit}
                    onEdit={onEditTask}
                    onSpecChange={setEditingSpec}
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

      {/* Queue Bar (sticky bottom) */}
      <div className="epic-detail__queue-bar">
        <div className="epic-detail__queue-info">
          <span className="epic-detail__queue-ready">
            {tasksReadyToQueue} task{tasksReadyToQueue === 1 ? '' : 's'} ready to queue
          </span>
          {tasksNeedingSpecs > 0 && (
            <>
              <span className="epic-detail__queue-separator">·</span>
              <span className="epic-detail__queue-needs-specs">
                {tasksNeedingSpecs} need{tasksNeedingSpecs === 1 ? 's' : ''} specs
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          className="epic-detail__queue-btn"
          onClick={onQueueAll}
          disabled={queueDisabled}
        >
          Send to Pipeline
        </button>
      </div>
      <ConfirmModal {...confirmProps} />
      <PromptModal {...promptProps} />
    </div>
  )
}
