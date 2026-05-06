import { useEffect, useState, useMemo, useCallback } from 'react'
import { useTaskGroups } from '../../../stores/taskGroups'
import { useTaskWorkbenchModalStore } from '../../../stores/taskWorkbenchModal'
import { useSprintTasks } from '../../../stores/sprintTasks'
import { PlPlannerHeader } from './PlPlannerHeader'
import { PlEpicRail } from './PlEpicRail'
import { PlEpicCanvas } from './PlEpicCanvas'
import { PlAssistantColumn } from './PlAssistantColumn'
import { CreateEpicModal } from '../CreateEpicModal'
import { toast } from '../../../stores/toasts'
import { useConfirm, ConfirmModal } from '../../ui/ConfirmModal'
import type { TaskGroup, SprintTask } from '../../../../../shared/types'

export function PlannerViewV2(): React.JSX.Element {
  const {
    groups,
    selectedGroupId,
    groupTasks,
    loadGroups,
    selectGroup,
    queueAllTasks,
    updateGroup,
    togglePause,
    loadGroupTasks
  } = useTaskGroups()

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantPrefill, setAssistantPrefill] = useState('')
  const [assistantKey, setAssistantKey] = useState(0)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const { confirm, confirmProps } = useConfirm()

  useEffect(() => {
    void loadGroups()
  }, [loadGroups])

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId]
  )

  const handleSelectEpic = useCallback(
    (id: string) => {
      selectGroup(id)
      setSelectedTaskId(null)
    },
    [selectGroup]
  )

  const handleSelectTask = useCallback((id: string) => {
    setSelectedTaskId(id)
  }, [])

  const handleAddTask = useCallback(() => {
    useTaskWorkbenchModalStore.getState().openForCreate({ groupId: selectedGroupId })
  }, [selectedGroupId])

  const handleEditInWorkbench = useCallback((task: SprintTask) => {
    useTaskWorkbenchModalStore.getState().openForEdit(task)
  }, [])

  const handleToggleReady = useCallback(async () => {
    if (!selectedGroup) return
    const nextStatus: TaskGroup['status'] = selectedGroup.status === 'ready' ? 'draft' : 'ready'
    await updateGroup(selectedGroup.id, { status: nextStatus })
  }, [selectedGroup, updateGroup])

  const handleTogglePause = useCallback(() => {
    if (!selectedGroup) return
    void togglePause(selectedGroup.id)
  }, [selectedGroup, togglePause])

  const handleQueueAll = useCallback(async () => {
    if (!selectedGroupId || !selectedGroup) return
    const readyTasks = groupTasks.filter((t) => t.status === 'backlog' && t.spec?.trim())
    if (readyTasks.length === 0) {
      toast.error('No tasks ready to queue')
      return
    }
    const confirmed = await confirm({
      title: 'Queue Tasks',
      message: `Queue ${readyTasks.length} task${readyTasks.length === 1 ? '' : 's'} to the pipeline?`,
      confirmLabel: 'Queue'
    })
    if (!confirmed) return
    await queueAllTasks(selectedGroupId)
    await loadGroupTasks(selectedGroupId)
  }, [selectedGroupId, selectedGroup, groupTasks, confirm, queueAllTasks, loadGroupTasks])

  const handleImport = useCallback(async () => {
    try {
      const result = await window.api.planner.import('fleet')
      toast.success(`Imported "${result.epicName}" with ${result.taskCount} tasks`)
      await loadGroups()
      selectGroup(result.epicId)
    } catch (err) {
      if (err instanceof Error && err.message === 'No file selected') return
      toast.error('Failed to import plan — ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [loadGroups, selectGroup])

  const handleAskAssistantDraft = useCallback((message: string) => {
    setAssistantOpen(true)
    setAssistantPrefill(message)
    setAssistantKey((k) => k + 1)
  }, [])

  const updateTask = useSprintTasks((s) => s.updateTask)
  const handleSaveSpec = useCallback(
    async (taskId: string, spec: string): Promise<void> => {
      await updateTask(taskId, { spec })
      if (selectedGroupId) await loadGroupTasks(selectedGroupId)
    },
    [updateTask, selectedGroupId, loadGroupTasks]
  )

  const activeGroups = useMemo(() => groups.filter((g) => g.status !== 'completed'), [groups])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden'
      }}
    >
      <PlPlannerHeader
        groups={activeGroups}
        tasks={groupTasks}
        assistantOpen={assistantOpen}
        onToggleAssistant={() => setAssistantOpen((o) => !o)}
        onNewEpic={() => setShowCreateModal(true)}
        onImport={handleImport}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <PlEpicRail
          groups={groups}
          selectedId={selectedGroupId}
          onSelect={handleSelectEpic}
          onNewEpic={() => setShowCreateModal(true)}
        />

        {selectedGroup ? (
          <PlEpicCanvas
            epic={selectedGroup}
            tasks={groupTasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={handleSelectTask}
            assistantOpen={assistantOpen}
            onAddTask={handleAddTask}
            onEditInWorkbench={handleEditInWorkbench}
            onToggleReady={handleToggleReady}
            onTogglePause={handleTogglePause}
            onQueueAll={handleQueueAll}
            onAskAssistantDraft={handleAskAssistantDraft}
            onSaveSpec={handleSaveSpec}
          />
        ) : (
          <PlEmptyCanvas assistantOpen={assistantOpen} />
        )}

        {assistantOpen && selectedGroup && (
          <PlAssistantColumn
            key={assistantKey}
            epic={selectedGroup}
            tasks={groupTasks}
            initialInput={assistantPrefill}
            onAddTask={handleAddTask}
            onClose={() => setAssistantOpen(false)}
          />
        )}
      </div>

      <CreateEpicModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
      <ConfirmModal {...confirmProps} />
    </div>
  )
}

function PlEmptyCanvas({ assistantOpen }: { assistantOpen: boolean }): React.JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        borderRight: assistantOpen ? '1px solid var(--line)' : 'none'
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>Select an epic to get started</span>
    </div>
  )
}
