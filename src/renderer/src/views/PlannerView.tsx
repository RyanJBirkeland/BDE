import { useEffect, useState, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTaskGroups } from '../stores/taskGroups'
import { useTaskWorkbenchStore } from '../stores/taskWorkbench'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { EpicList } from '../components/planner/EpicList'
import { EpicDetail } from '../components/planner/EpicDetail'
import { CreateEpicModal } from '../components/planner/CreateEpicModal'
import { toast } from '../stores/toasts'
import { useConfirm, ConfirmModal } from '../components/ui/ConfirmModal'
import { EmptyState } from '../components/ui/EmptyState'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import './PlannerView.css'

export default function PlannerView(): React.JSX.Element {
  const reduced = useReducedMotion()
  const {
    groups,
    selectedGroupId,
    groupTasks,
    loading,
    loadGroups,
    selectGroup,
    queueAllTasks,
    updateGroup,
    deleteGroup,
    reorderTasks,
    addDependency,
    removeDependency,
    updateDependencyCondition
  } = useTaskGroups()

  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const { confirm, confirmProps } = useConfirm()

  // Load groups on mount
  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  // Filter groups by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups
    const query = searchQuery.toLowerCase()
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(query) || (g.goal && g.goal.toLowerCase().includes(query))
    )
  }, [groups, searchQuery])

  // Get the selected group object
  const selectedGroup = useMemo(() => {
    return groups.find((g) => g.id === selectedGroupId) || null
  }, [groups, selectedGroupId])

  // Handlers
  const handleCreateNew = (): void => {
    setShowCreateModal(true)
  }

  const handleAddTask = useCallback((): void => {
    const workbenchStore = useTaskWorkbenchStore.getState()
    const panelStore = usePanelLayoutStore.getState()

    workbenchStore.resetForm()
    workbenchStore.setField('pendingGroupId', selectedGroupId)
    panelStore.setView('task-workbench')
  }, [selectedGroupId])

  const handleEditTask = useCallback(
    (taskId: string): void => {
      const task = groupTasks.find((t) => t.id === taskId)
      if (task) {
        useTaskWorkbenchStore.getState().loadTask(task)
        usePanelLayoutStore.getState().setView('task-workbench')
      }
    },
    [groupTasks]
  )

  const handleEditGroup = async (name: string, goal: string): Promise<void> => {
    if (!selectedGroupId) return
    await updateGroup(selectedGroupId, { name, goal })
  }

  const handleDeleteGroup = async (): Promise<void> => {
    if (!selectedGroupId) return
    await deleteGroup(selectedGroupId)
  }

  const handleToggleReady = async (): Promise<void> => {
    if (!selectedGroup) return
    const newStatus = selectedGroup.status === 'ready' ? 'draft' : 'ready'
    await updateGroup(selectedGroup.id, { status: newStatus })
  }

  const handleMarkCompleted = async (): Promise<void> => {
    if (!selectedGroup) return

    const confirmed = await confirm({
      title: 'Mark Epic as Completed',
      message: `Mark "${selectedGroup.name}" as completed? It will move to the Completed section.`,
      confirmLabel: 'Complete'
    })

    if (!confirmed) return
    await updateGroup(selectedGroup.id, { status: 'completed' })
  }

  const handleQueueAll = async (): Promise<void> => {
    if (!selectedGroupId || !selectedGroup) return

    // Count tasks ready to queue (backlog tasks with specs)
    const tasksToQueue = groupTasks.filter(
      (t) => t.status === 'backlog' && t.spec && t.spec.trim() !== ''
    )

    if (tasksToQueue.length === 0) {
      toast.error('No tasks ready to queue')
      return
    }

    const confirmed = await confirm({
      title: 'Queue Tasks',
      message: `Queue ${tasksToQueue.length} task${tasksToQueue.length === 1 ? '' : 's'} to the pipeline? This will transition all draft tasks with specs to queued status.`,
      confirmLabel: 'Queue'
    })

    if (!confirmed) return

    await queueAllTasks(selectedGroupId)
  }

  const handleReorderTasks = async (orderedTaskIds: string[]): Promise<void> => {
    if (!selectedGroupId) return
    await reorderTasks(selectedGroupId, orderedTaskIds)
  }

  const handleImportPlan = async (): Promise<void> => {
    try {
      const result = await window.api.planner.import('bde')
      toast.success(`Imported "${result.epicName}" with ${result.taskCount} tasks`)
      await loadGroups()
      selectGroup(result.epicId)
    } catch (err) {
      if (err instanceof Error && err.message === 'No file selected') {
        // User cancelled, don't show error
        return
      }
      toast.error('Failed to import plan — ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  return (
    <motion.div
      className="planner-view"
      variants={VARIANTS.fadeIn}
      initial="initial"
      animate="animate"
      transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
    >
      {/* Body: Split layout */}
      <div className="planner-body view-layout">
        <EpicList
          groups={filteredGroups}
          selectedId={selectedGroupId}
          onSelect={selectGroup}
          onCreateNew={handleCreateNew}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onImport={handleImportPlan}
        />
        <div className="view-content">
          {selectedGroup && (
            <EpicDetail
              group={selectedGroup}
              tasks={groupTasks}
              allGroups={groups}
              onAddDependency={(dep) => addDependency(selectedGroup.id, dep)}
              onRemoveDependency={(upstreamId) => removeDependency(selectedGroup.id, upstreamId)}
              onUpdateDependencyCondition={(upstreamId, condition) =>
                updateDependencyCondition(selectedGroup.id, upstreamId, condition)
              }
              loading={loading}
              onQueueAll={handleQueueAll}
              onAddTask={handleAddTask}
              onEditTask={handleEditTask}
              onEditGroup={handleEditGroup}
              onDeleteGroup={handleDeleteGroup}
              onToggleReady={handleToggleReady}
              onReorderTasks={handleReorderTasks}
              onMarkCompleted={handleMarkCompleted}
            />
          )}
          {!selectedGroup && !loading && <EmptyState message="Select an epic to view details" />}
        </div>
      </div>

      <CreateEpicModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
      <ConfirmModal {...confirmProps} />
    </motion.div>
  )
}
