import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSprintTasks } from '../stores/sprintTasks'
import { useSprintUI } from '../stores/sprintUI'
import { useSprintSelection } from '../stores/sprintSelection'
import { useCodeReviewStore } from '../stores/codeReview'
import { useSprintEvents } from '../stores/sprintEvents'
import { useFilteredTasks } from './useFilteredTasks'
import type { SprintTask } from '../../../shared/types'

export interface SprintPipelineState {
  // Tasks data
  tasks: SprintTask[]
  loading: boolean
  loadError: string | null

  // Actions
  updateTask: (taskId: string, patch: Partial<SprintTask>) => Promise<void>
  loadData: () => Promise<void>
  batchRequeueTasks: (ids: string[]) => Promise<void>

  // Selection
  selectedTaskId: string | null
  selectedTaskIds: Set<string>
  drawerOpen: boolean
  specPanelOpen: boolean
  logDrawerTaskId: string | null
  setSelectedTaskId: (id: string | null) => void
  setDrawerOpen: (open: boolean) => void
  setSpecPanelOpen: (open: boolean) => void
  setLogDrawerTaskId: (id: string | null) => void
  clearMultiSelection: () => void

  // UI overlays
  doneViewOpen: boolean
  conflictDrawerOpen: boolean
  healthCheckDrawerOpen: boolean
  setDoneViewOpen: (open: boolean) => void
  setConflictDrawerOpen: (open: boolean) => void
  setHealthCheckDrawerOpen: (open: boolean) => void

  // Cross-domain actions
  selectCodeReviewTask: (id: string) => void

  // Events
  initTaskOutputListener: () => () => void

  // Derived / filtered
  filteredTasks: SprintTask[]
  filteredPartition: ReturnType<typeof useFilteredTasks>['filteredPartition']
  partition: ReturnType<typeof useFilteredTasks>['partition']
  selectedTask: SprintTask | null
  conflictingTasks: SprintTask[]
}

/** Tasks that have an open PR with a merge conflict the user needs to resolve. */
function hasOpenMergeConflict(t: SprintTask): boolean {
  return (
    !!t.pr_url &&
    !!t.pr_number &&
    t.pr_mergeable_state === 'dirty' &&
    (t.status === 'active' || t.status === 'done')
  )
}

/**
 * Centralises all store subscriptions for SprintPipeline.
 * Computes derived data (selectedTask, conflictingTasks) inside the hook
 * so the component only receives ready-to-render values.
 */
export function useSprintPipelineState(): SprintPipelineState {
  const { tasks, loading, loadError } = useSprintTasks(
    useShallow((s) => ({ tasks: s.tasks, loading: s.loading, loadError: s.loadError }))
  )
  const updateTask = useSprintTasks((s) => s.updateTask)
  const loadData = useSprintTasks((s) => s.loadData)
  const batchRequeueTasks = useSprintTasks((s) => s.batchRequeueTasks)

  const { selectedTaskId, selectedTaskIds, drawerOpen, specPanelOpen, logDrawerTaskId } =
    useSprintSelection(
      useShallow((s) => ({
        selectedTaskId: s.selectedTaskId,
        selectedTaskIds: s.selectedTaskIds,
        drawerOpen: s.drawerOpen,
        specPanelOpen: s.specPanelOpen,
        logDrawerTaskId: s.logDrawerTaskId
      }))
    )
  const {
    setSelectedTaskId,
    setDrawerOpen,
    setSpecPanelOpen,
    setLogDrawerTaskId,
    clearMultiSelection
  } = useSprintSelection(
    useShallow((s) => ({
      setSelectedTaskId: s.setSelectedTaskId,
      setDrawerOpen: s.setDrawerOpen,
      setSpecPanelOpen: s.setSpecPanelOpen,
      setLogDrawerTaskId: s.setLogDrawerTaskId,
      clearMultiSelection: s.clearMultiSelection
    }))
  )

  const { doneViewOpen, conflictDrawerOpen, healthCheckDrawerOpen } = useSprintUI(
    useShallow((s) => ({
      doneViewOpen: s.doneViewOpen,
      conflictDrawerOpen: s.conflictDrawerOpen,
      healthCheckDrawerOpen: s.healthCheckDrawerOpen
    }))
  )
  const { setDoneViewOpen, setConflictDrawerOpen, setHealthCheckDrawerOpen } = useSprintUI(
    useShallow((s) => ({
      setDoneViewOpen: s.setDoneViewOpen,
      setConflictDrawerOpen: s.setConflictDrawerOpen,
      setHealthCheckDrawerOpen: s.setHealthCheckDrawerOpen
    }))
  )

  const selectCodeReviewTask = useCodeReviewStore((s) => s.selectTask)
  const initTaskOutputListener = useSprintEvents((s) => s.initTaskOutputListener)

  const { filteredTasks, filteredPartition, partition } = useFilteredTasks()

  const selectedTask = useMemo(
    () => (selectedTaskId ? (tasks.find((t) => t.id === selectedTaskId) ?? null) : null),
    [selectedTaskId, tasks]
  )

  const conflictingTasks = useMemo(() => tasks.filter(hasOpenMergeConflict), [tasks])

  return {
    tasks,
    loading,
    loadError,
    updateTask,
    loadData,
    batchRequeueTasks,
    selectedTaskId,
    selectedTaskIds,
    drawerOpen,
    specPanelOpen,
    logDrawerTaskId,
    setSelectedTaskId,
    setDrawerOpen,
    setSpecPanelOpen,
    setLogDrawerTaskId,
    clearMultiSelection,
    doneViewOpen,
    conflictDrawerOpen,
    healthCheckDrawerOpen,
    setDoneViewOpen,
    setConflictDrawerOpen,
    setHealthCheckDrawerOpen,
    selectCodeReviewTask,
    initTaskOutputListener,
    filteredTasks,
    filteredPartition,
    partition,
    selectedTask,
    conflictingTasks
  }
}
