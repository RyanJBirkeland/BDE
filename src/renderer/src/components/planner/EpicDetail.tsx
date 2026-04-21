import React, { useMemo, useState } from 'react'
import type { TaskGroup, SprintTask, EpicDependency } from '../../../../shared/types'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import { usePrompt, PromptModal } from '../ui/PromptModal'
import { toast } from '../../stores/toasts'
import { EpicDependencySection } from './EpicDependencySection'
import { EpicHeader } from './EpicHeader'
import { EpicProgress } from './EpicProgress'
import { TaskList } from './TaskList'
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
  loading?: boolean | undefined
  onQueueAll: () => void
  onAddTask: () => void
  onEditTask: (taskId: string) => void
  onEditGroup?: ((name: string, goal: string) => void) | undefined
  onDeleteGroup?: (() => void) | undefined
  onToggleReady?: (() => void) | undefined
  onReorderTasks?: ((orderedTaskIds: string[]) => void) | undefined
  onMarkCompleted?: (() => void) | undefined
  onOpenAssistant: () => void
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
  onMarkCompleted,
  onOpenAssistant
}: EpicDetailProps): React.JSX.Element {
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

  const doneCount = tasks.filter((t) => t.status === 'done').length
  const totalCount = tasks.length

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

  return (
    <div className="bde-panel epic-detail">
      {/* Header */}
      <EpicHeader
        group={group}
        isReady={isReady}
        isCompleted={isCompleted}
        doneCount={doneCount}
        totalCount={totalCount}
        onOpenAssistant={onOpenAssistant}
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
      <TaskList
        tasks={tasks}
        editingTaskId={editingTaskId}
        editingSpec={editingSpec}
        saving={saving}
        loading={loading}
        onEditStart={handleTaskClick}
        onCancelEdit={handleCancelEdit}
        onSaveEdit={handleSaveEdit}
        onEditTask={onEditTask}
        onAddTask={onAddTask}
        onReorderTasks={onReorderTasks}
        onSpecChange={setEditingSpec}
      />

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
