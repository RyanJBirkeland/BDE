import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Edit2, MoreVertical, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { TaskGroup, SprintTask, EpicDependency } from '../../../../shared/types'
import { STATUS_METADATA } from '../../../../shared/task-state-machine'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import { usePrompt, PromptModal } from '../ui/PromptModal'
import { LoadingState } from '../ui/LoadingState'
import { toast } from '../../stores/toasts'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { EpicDependencySection } from './EpicDependencySection'
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

interface StatusCounts {
  done: number
  active: number
  queued: number
  blocked: number
  draft: number
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
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingSpec, setEditingSpec] = useState('')
  const [saving, setSaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuItemsRef = useRef<HTMLButtonElement[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { confirm, confirmProps } = useConfirm()
  const { prompt, promptProps } = usePrompt()

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowOverflowMenu(false)
      }
    }
    if (showOverflowMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      // Focus the first menu item when the menu opens
      requestAnimationFrame(() => {
        menuItemsRef.current[0]?.focus()
      })
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
    return undefined
  }, [showOverflowMenu])

  // Keyboard navigation for overflow menu
  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = menuItemsRef.current.filter(Boolean)
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0
        items[next]?.focus()
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1
        items[prev]?.focus()
        break
      }
      case 'Escape':
        e.preventDefault()
        setShowOverflowMenu(false)
        break
      case 'Tab':
        setShowOverflowMenu(false)
        break
    }
  }, [])

  // Calculate status breakdown
  const counts: StatusCounts = useMemo(() => {
    const initial: StatusCounts = { done: 0, active: 0, queued: 0, blocked: 0, draft: 0 }
    return tasks.reduce((acc, task) => {
      if (task.status === 'done') acc.done++
      else if (task.status === 'active') acc.active++
      else if (task.status === 'queued') acc.queued++
      else if (task.status === 'blocked') acc.blocked++
      else if (task.status === 'backlog') acc.draft++
      return acc
    }, initial)
  }, [tasks])

  // Count tasks missing specs (backlog/draft tasks with no spec)
  const tasksNeedingSpecs = useMemo(() => {
    return tasks.filter((t) => t.status === 'backlog' && (!t.spec || t.spec.trim() === '')).length
  }, [tasks])

  // Count tasks ready to queue (backlog tasks WITH specs)
  const tasksReadyToQueue = useMemo(() => {
    return tasks.filter((t) => t.status === 'backlog' && t.spec && t.spec.trim() !== '').length
  }, [tasks])

  // Progress percentage
  const progressPercent = useMemo(() => {
    if (tasks.length === 0) return 0
    return Math.round((counts.done / tasks.length) * 100)
  }, [counts.done, tasks.length])

  const progressColor = useMemo(() => {
    if (progressPercent === 100) return 'var(--bde-accent)'
    if (progressPercent >= 50) return 'var(--bde-status-review)'
    if (progressPercent > 0) return 'var(--bde-warning)'
    return 'var(--bde-text-dim)'
  }, [progressPercent])

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
    setShowOverflowMenu(false)
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
    setShowOverflowMenu(false)
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
    setShowOverflowMenu(false)
    if (!onToggleReady) return
    onToggleReady()
  }

  const handleMarkCompleted = (): void => {
    setShowOverflowMenu(false)
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

  const handleSpecKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSaveEdit()
    }
  }

  // Focus textarea when editing starts
  useEffect(() => {
    if (editingTaskId && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [editingTaskId])

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
    <div className="epic-detail">
      {/* Header */}
      <div className="epic-detail__header">
        <div
          className="epic-detail__icon"
          style={{
            background: `${group.accent_color}20`,
            color: group.accent_color,
            borderColor: `${group.accent_color}40`
          }}
        >
          {group.icon.charAt(0).toUpperCase()}
        </div>
        <div className="epic-detail__header-content">
          <h2 className="epic-detail__name">{group.name}</h2>
          {group.goal && <p className="epic-detail__goal">{group.goal}</p>}
        </div>
        <div className="epic-detail__header-actions" style={{ position: 'relative' }} ref={menuRef}>
          <button
            type="button"
            className="epic-detail__header-btn"
            onClick={() => setShowOverflowMenu(!showOverflowMenu)}
            aria-label="More options"
            aria-expanded={showOverflowMenu}
            aria-haspopup="menu"
          >
            <MoreVertical size={16} />
          </button>
          {showOverflowMenu && (
            <div
              className="epic-detail__overflow-menu"
              role="menu"
              onKeyDown={handleMenuKeyDown}
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '4px',
                background: 'var(--bde-bg)',
                border: `1px solid ${'var(--bde-accent)'}40`,
                borderRadius: '4px',
                minWidth: '160px',
                zIndex: 100,
                boxShadow: 'none'
              }}
            >
              <button
                ref={(el): void => {
                  if (el) menuItemsRef.current[0] = el
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="epic-detail__overflow-item"
                onClick={handleEdit}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--bde-text)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left'
                }}
              >
                <Edit2 size={14} />
                Edit
              </button>
              <button
                ref={(el): void => {
                  if (el) menuItemsRef.current[1] = el
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="epic-detail__overflow-item"
                onClick={handleToggleReady}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--bde-text)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left'
                }}
              >
                {isReady ? 'Mark as Draft' : 'Mark as Ready'}
              </button>
              {!isCompleted && (
                <button
                  ref={(el): void => {
                    if (el) menuItemsRef.current[2] = el
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="epic-detail__overflow-item"
                  onClick={handleMarkCompleted}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--bde-status-done)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    textAlign: 'left'
                  }}
                >
                  <CheckCircle2 size={14} />
                  Mark as Completed
                </button>
              )}
              <button
                ref={(el): void => {
                  if (el) menuItemsRef.current[isCompleted ? 2 : 3] = el
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="epic-detail__overflow-item"
                onClick={handleDelete}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--bde-danger)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left'
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Progress Section */}
      <div className="epic-detail__progress">
        <div className="epic-detail__progress-bar-track">
          <div
            className="epic-detail__progress-bar-fill"
            style={{
              width: `${progressPercent}%`,
              background: progressColor
            }}
          />
        </div>
        <div className="epic-detail__status-breakdown">
          <span className="epic-detail__status-count epic-detail__status-count--done">
            {counts.done} done
          </span>
          <span className="epic-detail__status-count epic-detail__status-count--active">
            {counts.active} active
          </span>
          <span className="epic-detail__status-count epic-detail__status-count--queued">
            {counts.queued} queued
          </span>
          <span className="epic-detail__status-count epic-detail__status-count--blocked">
            {counts.blocked} blocked
          </span>
          <span className="epic-detail__status-count epic-detail__status-count--draft">
            {counts.draft} draft
          </span>
        </div>

        {tasksNeedingSpecs > 0 && (
          <div className="epic-detail__readiness-warning">
            <AlertTriangle size={14} />
            <span>
              {tasksNeedingSpecs} task{tasksNeedingSpecs === 1 ? '' : 's'} missing specs
            </span>
          </div>
        )}
      </div>

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
              const hasSpec = task.spec && task.spec.trim() !== ''
              const hasDeps = task.depends_on && task.depends_on.length > 0
              const isDragging = draggedTaskId === task.id
              const isDragOver = dragOverTaskId === task.id
              const isEditing = editingTaskId === task.id

              return (
                <motion.div
                  key={task.id}
                  variants={VARIANTS.staggerChild}
                  transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
                >
                  <div
                    className="epic-detail__task-row"
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDragOver={(e) => handleDragOver(e, task.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, task.id)}
                    onDragEnd={handleDragEnd}
                    style={{
                      opacity: isDragging ? 0.5 : 1,
                      borderTop: isDragOver ? `2px solid ${'var(--bde-accent)'}` : undefined,
                      cursor: 'grab'
                    }}
                  >
                    {!isEditing ? (
                      <>
                        <div
                          className="epic-detail__task-status-dot"
                          style={{ background: `var(${STATUS_METADATA[task.status].colorToken})` }}
                        />
                        <span
                          className="epic-detail__task-title"
                          onClick={() => handleTaskClick(task)}
                          style={{
                            cursor: task.status === 'backlog' ? 'pointer' : 'default'
                          }}
                        >
                          {task.title}
                        </span>
                        {!hasSpec && task.status === 'backlog' && (
                          <span className="epic-detail__task-flag epic-detail__task-flag--warning">
                            no spec
                          </span>
                        )}
                        {hasDeps && task.depends_on && (
                          <span className="epic-detail__task-dep-ref">
                            {task.depends_on.length} dep{task.depends_on.length === 1 ? '' : 's'}
                          </span>
                        )}
                        <span
                          className="epic-detail__task-status-badge"
                          style={{ color: `var(${STATUS_METADATA[task.status].colorToken})` }}
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
                      </>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          width: '100%',
                          padding: '8px'
                        }}
                      >
                        <textarea
                          ref={textareaRef}
                          value={editingSpec}
                          onChange={(e) => setEditingSpec(e.target.value)}
                          onKeyDown={handleSpecKeyDown}
                          placeholder="Enter task spec..."
                          disabled={saving}
                          style={{
                            width: '100%',
                            minHeight: '120px',
                            padding: '8px',
                            background: 'var(--bde-bg)',
                            border: `1px solid ${'var(--bde-accent)'}40`,
                            borderRadius: '4px',
                            color: 'var(--bde-text)',
                            fontFamily: 'monospace',
                            fontSize: '13px',
                            resize: 'vertical'
                          }}
                        />
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            disabled={saving}
                            style={{
                              padding: '6px 12px',
                              background: 'transparent',
                              border: `1px solid ${'var(--bde-text-dim)'}`,
                              borderRadius: '4px',
                              color: 'var(--bde-text)',
                              cursor: saving ? 'not-allowed' : 'pointer',
                              fontSize: '13px'
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveEdit}
                            disabled={saving}
                            style={{
                              padding: '6px 12px',
                              background: 'var(--bde-accent)',
                              border: 'none',
                              borderRadius: '4px',
                              color: 'var(--bde-bg)',
                              cursor: saving ? 'not-allowed' : 'pointer',
                              fontSize: '13px',
                              fontWeight: 500
                            }}
                          >
                            {saving ? 'Saving...' : 'Save (⌘↵)'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
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
