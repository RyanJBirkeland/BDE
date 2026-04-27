import React, { useRef, useEffect } from 'react'
import { Edit2 } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'
import { STATUS_METADATA } from '../../lib/task-status-ui'
import { Textarea } from '../ui/Textarea'

export interface TaskRowProps {
  task: SprintTask
  isEditing: boolean
  editingSpec: string
  saving: boolean
  isDragging: boolean
  isDragOver: boolean
  onEditStart: (task: SprintTask) => void
  onCancelEdit: () => void
  onSaveEdit: () => Promise<void>
  onEdit: (taskId: string) => void
  onSpecChange: (spec: string) => void
  onDragStart: (e: React.DragEvent<HTMLDivElement>, taskId: string) => void
  onDragOver: (e: React.DragEvent<HTMLDivElement>, taskId: string) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent<HTMLDivElement>, targetTaskId: string) => void
  onDragEnd: () => void
}

export function TaskRow({
  task,
  isEditing,
  editingSpec,
  saving,
  isDragging,
  isDragOver,
  onEditStart,
  onCancelEdit,
  onSaveEdit,
  onEdit,
  onSpecChange,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd
}: TaskRowProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Focus textarea when editing starts
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isEditing])

  const handleSpecKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void onSaveEdit()
    }
  }

  const hasSpec = task.spec && task.spec.trim() !== ''
  const hasDeps = task.depends_on && task.depends_on.length > 0

  return (
    <div
      className="epic-detail__task-row"
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onDragOver={(e) => onDragOver(e, task.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, task.id)}
      onDragEnd={onDragEnd}
      style={{
        opacity: isDragging ? 0.5 : 1,
        borderTop: isDragOver ? `2px solid ${'var(--fleet-accent)'}` : undefined,
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
            onClick={() => onEditStart(task)}
            style={{
              cursor: task.status === 'backlog' ? 'pointer' : 'default'
            }}
          >
            {task.title}
          </span>
          {!hasSpec && task.status === 'backlog' && (
            <span className="epic-detail__task-flag epic-detail__task-flag--warning">no spec</span>
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
            onClick={() => onEdit(task.id)}
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
          <Textarea
            ref={textareaRef}
            value={editingSpec}
            onChange={onSpecChange}
            onKeyDown={handleSpecKeyDown}
            placeholder="Enter task spec..."
            disabled={saving}
            aria-label="Task spec"
            variant="code"
            resize="vertical"
            className="planner-task-row__spec-editor"
          />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={saving}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                border: `1px solid ${'var(--fleet-text-dim)'}`,
                borderRadius: '4px',
                color: 'var(--fleet-text)',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '13px'
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onSaveEdit()}
              disabled={saving}
              style={{
                padding: '6px 12px',
                background: 'var(--fleet-accent)',
                border: 'none',
                borderRadius: '4px',
                color: 'var(--fleet-bg)',
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
}
