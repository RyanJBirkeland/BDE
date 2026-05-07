import { useCallback } from 'react'
import { useSprintTasks } from '../../../stores/sprintTasks'
import { useSprintFilters, type StatusFilter } from '../../../stores/sprintFilters'
import { usePanelLayoutStore } from '../../../stores/panelLayout'
import { useTaskWorkbenchModalStore } from '../../../stores/taskWorkbenchModal'

export interface DashboardActions {
  openAgentsView: () => void
  openPipelineView: (filter?: StatusFilter) => void
  openReviewView: () => void
  openPlannerView: () => void
  openNewTask: () => void
  retryTask: (taskId: string) => Promise<void>
}

/**
 * Action callbacks for the Dashboard. Encapsulates view-navigation and task
 * mutation handlers so `useDashboardData` can stay focused on data derivation.
 */
export function useDashboardActions(): DashboardActions {
  const retryTaskFromStore = useSprintTasks((s) => s.retryTask)
  const setStatusFilter = useSprintFilters((s) => s.setStatusFilter)
  const setSearchQuery = useSprintFilters((s) => s.setSearchQuery)
  const setRepoFilter = useSprintFilters((s) => s.setRepoFilter)
  const setTagFilter = useSprintFilters((s) => s.setTagFilter)
  const setView = usePanelLayoutStore((s) => s.setView)
  const openForCreate = useTaskWorkbenchModalStore((s) => s.openForCreate)

  const openPipelineView = useCallback(
    (filter?: StatusFilter) => {
      setSearchQuery('')
      setRepoFilter(null)
      setTagFilter(null)
      if (filter) setStatusFilter(filter)
      setView('sprint')
    },
    [setStatusFilter, setSearchQuery, setRepoFilter, setTagFilter, setView]
  )

  const retryTask = useCallback(
    (taskId: string): Promise<void> => retryTaskFromStore(taskId),
    [retryTaskFromStore]
  )

  const openAgentsView = useCallback(() => setView('agents'), [setView])
  const openReviewView = useCallback(() => setView('code-review'), [setView])
  const openPlannerView = useCallback(() => setView('planner'), [setView])
  const openNewTask = useCallback(() => openForCreate(), [openForCreate])

  return {
    openAgentsView,
    openPipelineView,
    openReviewView,
    openPlannerView,
    openNewTask,
    retryTask
  }
}
