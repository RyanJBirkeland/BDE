import React, { useMemo, useState, useRef, useEffect } from 'react'
import { Edit2, MoreVertical, AlertTriangle } from 'lucide-react'
import type { TaskGroup, SprintTask } from '../../../../shared/types'
import { tokens } from '../../design-system/tokens'

export interface EpicDetailProps {
  group: TaskGroup
  tasks: SprintTask[]
  loading?: boolean
  onQueueAll: () => void
  onAddTask: () => void
  onEditTask: (taskId: string) => void
  onEditGroup?: (name: string, goal: string) => void
  onDeleteGroup?: () => void
  onToggleReady?: () => void
  onReorderTasks?: (orderedTaskIds: string[]) => void
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
  loading = false,
  onQueueAll,
  onAddTask,
  onEditTask,
  onEditGroup,
  onDeleteGroup,
  onToggleReady,
  onReorderTasks
}: EpicDetailProps): React.JSX.Element {
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingSpec, setEditingSpec] = useState('')
  const [saving, setSaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowOverflowMenu(false)
      }
    }
    if (showOverflowMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
    return undefined
  }, [showOverflowMenu])

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
    if (progressPercent === 100) return tokens.neon.cyan
    if (progressPercent >= 50) return tokens.neon.blue
    if (progressPercent > 0) return tokens.neon.orange
    return tokens.neon.textDim
  }, [progressPercent])

  // Helper to get status dot color
  const getStatusColor = (status: SprintTask['status']): string => {
    switch (status) {
      case 'done':
        return tokens.neon.cyan
      case 'active':
        return tokens.neon.blue
      case 'queued':
        return tokens.neon.orange
      case 'blocked':
        return tokens.neon.red
      case 'review':
        return tokens.neon.purple
      case 'failed':
      case 'error':
        return tokens.neon.red
      case 'cancelled':
        return tokens.neon.textDim
      case 'backlog':
      default:
        return tokens.neon.textMuted
    }
  }

  // Helper to get status label
  const getStatusLabel = (status: SprintTask['status']): string => {
    switch (status) {
      case 'done':
        return 'Done'
      case 'active':
        return 'Active'
      case 'queued':
        return 'Queued'
      case 'blocked':
        return 'Blocked'
      case 'review':
        return 'Review'
      case 'failed':
        return 'Failed'
      case 'error':
        return 'Error'
      case 'cancelled':
        return 'Cancelled'
      case 'backlog':
      default:
        return 'Draft'
    }
  }

  const queueDisabled = tasksNeedingSpecs > 0

  // Overflow menu handlers
  const handleEdit = (): void => {
    setShowOverflowMenu(false)
    if (!onEditGroup) return
    const name = window.prompt('Epic name:', group.name)
    if (name === null) return // User cancelled
    const goal = window.prompt('Epic goal (optional):', group.goal || '')
    if (goal === null) return // User cancelled
    onEditGroup(name.trim(), goal.trim())
  }

  const handleDelete = (): void => {
    setShowOverflowMenu(false)
    if (!onDeleteGroup) return
    const confirmed = window.confirm(`Delete epic "${group.name}"? This cannot be undone.`)
    if (confirmed) {
      onDeleteGroup()
    }
  }

  const handleToggleReady = (): void => {
    setShowOverflowMenu(false)
    if (!onToggleReady) return
    onToggleReady()
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
      alert('Failed to save spec. Please try again.')
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
          >
            <MoreVertical size={16} />
          </button>
          {showOverflowMenu && (
            <div
              className="epic-detail__overflow-menu"
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '4px',
                background: tokens.neon.surfaceDeep,
                border: `1px solid ${tokens.neon.cyan}40`,
                borderRadius: '4px',
                minWidth: '160px',
                zIndex: 100,
                boxShadow: `0 0 12px ${tokens.neon.cyan}20`
              }}
            >
              <button
                type="button"
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
                  color: tokens.neon.text,
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left'
                }}
              >
                <Edit2 size={14} />
                Edit
              </button>
              <button
                type="button"
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
                  color: tokens.neon.text,
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left'
                }}
              >
                {isReady ? 'Mark as Draft' : 'Mark as Ready'}
              </button>
              <button
                type="button"
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
                  color: tokens.neon.red,
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
          <span className="epic-detail__status-count" style={{ color: tokens.neon.cyan }}>
            {counts.done} done
          </span>
          <span className="epic-detail__status-count" style={{ color: tokens.neon.blue }}>
            {counts.active} active
          </span>
          <span className="epic-detail__status-count" style={{ color: tokens.neon.orange }}>
            {counts.queued} queued
          </span>
          <span className="epic-detail__status-count" style={{ color: tokens.neon.red }}>
            {counts.blocked} blocked
          </span>
          <span className="epic-detail__status-count" style={{ color: tokens.neon.textMuted }}>
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

      {/* Task List */}
      <div className="epic-detail__tasks">
        {loading ? (
          <div className="planner-empty">
            <p className="planner-empty__text">Loading tasks...</p>
          </div>
        ) : (
          <>
            {tasks.map((task) => {
              const hasSpec = task.spec && task.spec.trim() !== ''
              const hasDeps = task.depends_on && task.depends_on.length > 0
              const isDragging = draggedTaskId === task.id
              const isDragOver = dragOverTaskId === task.id
              const isEditing = editingTaskId === task.id

              return (
                <div
                  key={task.id}
                  className="epic-detail__task-row"
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  onDragOver={(e) => handleDragOver(e, task.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, task.id)}
                  onDragEnd={handleDragEnd}
                  style={{
                    opacity: isDragging ? 0.5 : 1,
                    borderTop: isDragOver ? `2px solid ${tokens.neon.cyan}` : undefined,
                    cursor: 'grab'
                  }}
                >
                  {!isEditing ? (
                    <>
                      <div
                        className="epic-detail__task-status-dot"
                        style={{ background: getStatusColor(task.status) }}
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
                        style={{ color: getStatusColor(task.status) }}
                      >
                        {getStatusLabel(task.status)}
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
                          background: tokens.neon.surfaceDeep,
                          border: `1px solid ${tokens.neon.cyan}40`,
                          borderRadius: '4px',
                          color: tokens.neon.text,
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
                            border: `1px solid ${tokens.neon.textDim}`,
                            borderRadius: '4px',
                            color: tokens.neon.text,
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
                            background: tokens.neon.cyan,
                            border: 'none',
                            borderRadius: '4px',
                            color: tokens.neon.surfaceDeep,
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
              )
            })}

            <button type="button" className="epic-detail__add-task-row" onClick={onAddTask}>
              + Add task
            </button>
          </>
        )}
      </div>

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
    </div>
  )
}
