import { useEffect, useState, useMemo, useCallback } from 'react'
import { useTaskGroups } from '../stores/taskGroups'
import { useTaskWorkbenchStore } from '../stores/taskWorkbench'
import { usePanelLayoutStore } from '../stores/panelLayout'
import { EpicList } from '../components/planner/EpicList'
import { EpicDetail } from '../components/planner/EpicDetail'
import { CreateEpicModal } from '../components/planner/CreateEpicModal'
import { Search } from 'lucide-react'

export default function PlannerView(): React.JSX.Element {
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
    reorderTasks
  } = useTaskGroups()

  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)

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

  const handleQueueAll = async (): Promise<void> => {
    if (!selectedGroupId) return
    await queueAllTasks(selectedGroupId)
  }

  const handleReorderTasks = async (orderedTaskIds: string[]): Promise<void> => {
    if (!selectedGroupId) return
    await reorderTasks(selectedGroupId, orderedTaskIds)
  }

  return (
    <div className="planner-view">
      {/* Header */}
      <div className="planner-header">
        <h1 className="planner-header__title">Task Planner</h1>
        <div className="planner-header__search">
          <Search size={16} className="planner-header__search-icon" />
          <input
            type="text"
            placeholder="Search epics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="planner-header__search-input"
          />
        </div>
      </div>

      {/* Body: Split layout */}
      <div className="planner-body">
        <EpicList
          groups={filteredGroups}
          selectedId={selectedGroupId}
          onSelect={selectGroup}
          onCreateNew={handleCreateNew}
        />
        {selectedGroup && (
          <EpicDetail
            group={selectedGroup}
            tasks={groupTasks}
            loading={loading}
            onQueueAll={handleQueueAll}
            onAddTask={handleAddTask}
            onEditTask={handleEditTask}
            onEditGroup={handleEditGroup}
            onDeleteGroup={handleDeleteGroup}
            onToggleReady={handleToggleReady}
            onReorderTasks={handleReorderTasks}
          />
        )}
        {!selectedGroup && !loading && (
          <div className="planner-empty">
            <p className="planner-empty__text">Select an epic to view details</p>
          </div>
        )}
      </div>

      <CreateEpicModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
    </div>
  )
}
