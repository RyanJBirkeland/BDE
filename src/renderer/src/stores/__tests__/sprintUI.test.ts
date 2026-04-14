import { describe, it, expect, beforeEach } from 'vitest'
import { useSprintUI } from '../sprintUI'
import { useSprintSelection } from '../sprintSelection'
import { useSprintFilters } from '../sprintFilters'

describe('sprintSelection store', () => {
  beforeEach(() => {
    useSprintSelection.setState({
      selectedTaskId: null,
      logDrawerTaskId: null,
      selectedTaskIds: new Set<string>(),
      drawerOpen: false,
      specPanelOpen: false
    })
  })

  it('starts with all null/false defaults', () => {
    const state = useSprintSelection.getState()
    expect(state.selectedTaskId).toBeNull()
    expect(state.logDrawerTaskId).toBeNull()
    expect(state.drawerOpen).toBe(false)
    expect(state.specPanelOpen).toBe(false)
    expect(state.selectedTaskIds.size).toBe(0)
  })

  it('setSelectedTaskId updates selectedTaskId', () => {
    useSprintSelection.getState().setSelectedTaskId('task-123')
    expect(useSprintSelection.getState().selectedTaskId).toBe('task-123')
  })

  it('setSelectedTaskId can set to null', () => {
    useSprintSelection.getState().setSelectedTaskId('task-123')
    useSprintSelection.getState().setSelectedTaskId(null)
    expect(useSprintSelection.getState().selectedTaskId).toBeNull()
  })

  it('setLogDrawerTaskId updates logDrawerTaskId', () => {
    useSprintSelection.getState().setLogDrawerTaskId('task-456')
    expect(useSprintSelection.getState().logDrawerTaskId).toBe('task-456')
  })

  it('setLogDrawerTaskId can set to null', () => {
    useSprintSelection.getState().setLogDrawerTaskId('task-456')
    useSprintSelection.getState().setLogDrawerTaskId(null)
    expect(useSprintSelection.getState().logDrawerTaskId).toBeNull()
  })

  it('clearSelection clears selectedTaskIds', () => {
    useSprintSelection.getState().toggleTaskSelection('task-1')
    useSprintSelection.getState().toggleTaskSelection('task-2')
    expect(useSprintSelection.getState().selectedTaskIds.size).toBe(2)
    useSprintSelection.getState().clearSelection()
    expect(useSprintSelection.getState().selectedTaskIds.size).toBe(0)
  })

  it('toggleTaskSelection adds task to selection', () => {
    useSprintSelection.getState().toggleTaskSelection('task-1')
    expect(useSprintSelection.getState().selectedTaskIds.has('task-1')).toBe(true)
  })

  it('toggleTaskSelection removes task from selection', () => {
    useSprintSelection.getState().toggleTaskSelection('task-1')
    expect(useSprintSelection.getState().selectedTaskIds.has('task-1')).toBe(true)
    useSprintSelection.getState().toggleTaskSelection('task-1')
    expect(useSprintSelection.getState().selectedTaskIds.has('task-1')).toBe(false)
  })

  it('toggleTaskSelection works with multiple tasks', () => {
    useSprintSelection.getState().toggleTaskSelection('task-1')
    useSprintSelection.getState().toggleTaskSelection('task-2')
    useSprintSelection.getState().toggleTaskSelection('task-3')
    const selected = useSprintSelection.getState().selectedTaskIds
    expect(selected.size).toBe(3)
    expect(selected.has('task-1')).toBe(true)
    expect(selected.has('task-2')).toBe(true)
    expect(selected.has('task-3')).toBe(true)
  })

  it('clearMultiSelection clears all selected tasks', () => {
    useSprintSelection.getState().toggleTaskSelection('task-1')
    useSprintSelection.getState().toggleTaskSelection('task-2')
    expect(useSprintSelection.getState().selectedTaskIds.size).toBe(2)
    useSprintSelection.getState().clearMultiSelection()
    expect(useSprintSelection.getState().selectedTaskIds.size).toBe(0)
  })

  it('setSelectedTaskId toggles off when selecting same task', () => {
    useSprintSelection.getState().setSelectedTaskId('task-1')
    expect(useSprintSelection.getState().selectedTaskId).toBe('task-1')
    expect(useSprintSelection.getState().drawerOpen).toBe(true)

    useSprintSelection.getState().setSelectedTaskId('task-1')
    expect(useSprintSelection.getState().selectedTaskId).toBeNull()
    expect(useSprintSelection.getState().drawerOpen).toBe(false)
  })

  it('setSelectedTaskId opens drawer when selecting a task', () => {
    useSprintSelection.getState().setSelectedTaskId('task-1')
    expect(useSprintSelection.getState().drawerOpen).toBe(true)
  })

  it('setSelectedTaskId closes drawer when selecting null', () => {
    useSprintSelection.getState().setSelectedTaskId('task-1')
    useSprintSelection.getState().setSelectedTaskId(null)
    expect(useSprintSelection.getState().drawerOpen).toBe(false)
  })

  it('setDrawerOpen toggles drawer', () => {
    useSprintSelection.getState().setDrawerOpen(true)
    expect(useSprintSelection.getState().drawerOpen).toBe(true)
    useSprintSelection.getState().setDrawerOpen(false)
    expect(useSprintSelection.getState().drawerOpen).toBe(false)
  })

  it('setSpecPanelOpen toggles spec panel', () => {
    useSprintSelection.getState().setSpecPanelOpen(true)
    expect(useSprintSelection.getState().specPanelOpen).toBe(true)
    useSprintSelection.getState().setSpecPanelOpen(false)
    expect(useSprintSelection.getState().specPanelOpen).toBe(false)
  })

  it('clearTaskIfSelected clears if task is selected', () => {
    useSprintSelection.getState().setSelectedTaskId('task-1')
    useSprintSelection.getState().clearTaskIfSelected('task-1')
    expect(useSprintSelection.getState().selectedTaskId).toBeNull()
    expect(useSprintSelection.getState().drawerOpen).toBe(false)
  })

  it('clearTaskIfSelected does nothing if task is not selected', () => {
    useSprintSelection.getState().setSelectedTaskId('task-1')
    useSprintSelection.getState().clearTaskIfSelected('task-2')
    expect(useSprintSelection.getState().selectedTaskId).toBe('task-1')
  })
})

describe('sprintFilters store', () => {
  beforeEach(() => {
    useSprintFilters.setState({
      repoFilter: null,
      tagFilter: null,
      searchQuery: '',
      statusFilter: 'all'
    })
  })

  it('starts with all default filter values', () => {
    const state = useSprintFilters.getState()
    expect(state.repoFilter).toBeNull()
    expect(state.tagFilter).toBeNull()
    expect(state.searchQuery).toBe('')
    expect(state.statusFilter).toBe('all')
  })

  it('setRepoFilter updates repoFilter', () => {
    useSprintFilters.getState().setRepoFilter('bde')
    expect(useSprintFilters.getState().repoFilter).toBe('bde')
  })

  it('setRepoFilter can clear the filter', () => {
    useSprintFilters.getState().setRepoFilter('bde')
    useSprintFilters.getState().setRepoFilter(null)
    expect(useSprintFilters.getState().repoFilter).toBeNull()
  })

  it('setSearchQuery updates searchQuery', () => {
    useSprintFilters.getState().setSearchQuery('hello')
    expect(useSprintFilters.getState().searchQuery).toBe('hello')
  })

  it('setSearchQuery can clear query', () => {
    useSprintFilters.getState().setSearchQuery('hello')
    useSprintFilters.getState().setSearchQuery('')
    expect(useSprintFilters.getState().searchQuery).toBe('')
  })

  it('setStatusFilter updates statusFilter', () => {
    useSprintFilters.getState().setStatusFilter('blocked')
    expect(useSprintFilters.getState().statusFilter).toBe('blocked')
  })

  it('setStatusFilter can reset to all', () => {
    useSprintFilters.getState().setStatusFilter('done')
    useSprintFilters.getState().setStatusFilter('all')
    expect(useSprintFilters.getState().statusFilter).toBe('all')
  })

  it('setTagFilter updates tagFilter', () => {
    useSprintFilters.getState().setTagFilter('urgent')
    expect(useSprintFilters.getState().tagFilter).toBe('urgent')
  })

  it('setTagFilter can clear the filter', () => {
    useSprintFilters.getState().setTagFilter('urgent')
    useSprintFilters.getState().setTagFilter(null)
    expect(useSprintFilters.getState().tagFilter).toBeNull()
  })

  it('clearAllFilters resets every filter to its default', () => {
    useSprintFilters.getState().setStatusFilter('in-progress')
    useSprintFilters.getState().setRepoFilter('bde')
    useSprintFilters.getState().setTagFilter('urgent')
    useSprintFilters.getState().setSearchQuery('hello')

    useSprintFilters.getState().clearAllFilters()

    const state = useSprintFilters.getState()
    expect(state.statusFilter).toBe('all')
    expect(state.repoFilter).toBeNull()
    expect(state.tagFilter).toBeNull()
    expect(state.searchQuery).toBe('')
  })

  it('clearAllFilters is a no-op when no filters are set', () => {
    useSprintFilters.getState().clearAllFilters()

    const state = useSprintFilters.getState()
    expect(state.statusFilter).toBe('all')
    expect(state.repoFilter).toBeNull()
    expect(state.tagFilter).toBeNull()
    expect(state.searchQuery).toBe('')
  })
})

describe('sprintUI store', () => {
  beforeEach(() => {
    useSprintUI.setState({
      generatingIds: [],
      doneViewOpen: false,
      conflictDrawerOpen: false,
      healthCheckDrawerOpen: false,
      quickCreateOpen: false,
      pipelineDensity: 'card'
    })
  })

  it('starts with default values', () => {
    const state = useSprintUI.getState()
    expect(state.generatingIds.length).toBe(0)
    expect(Array.isArray(state.generatingIds)).toBe(true)
    expect(state.doneViewOpen).toBe(false)
    expect(state.quickCreateOpen).toBe(false)
    expect(state.pipelineDensity).toBe('card')
  })

  it('setGeneratingIds adds an id', () => {
    useSprintUI.getState().setGeneratingIds((prev) => [...prev, 'task-1'])
    expect(useSprintUI.getState().generatingIds.includes('task-1')).toBe(true)
  })

  it('setGeneratingIds removes an id', () => {
    useSprintUI.getState().setGeneratingIds(() => ['task-1', 'task-2'])
    useSprintUI.getState().setGeneratingIds((prev) => prev.filter((id) => id !== 'task-1'))
    const ids = useSprintUI.getState().generatingIds
    expect(ids.includes('task-1')).toBe(false)
    expect(ids.includes('task-2')).toBe(true)
  })

  it('setDoneViewOpen toggles done view', () => {
    useSprintUI.getState().setDoneViewOpen(true)
    expect(useSprintUI.getState().doneViewOpen).toBe(true)
  })

  it('setConflictDrawerOpen toggles conflict drawer', () => {
    useSprintUI.getState().setConflictDrawerOpen(true)
    expect(useSprintUI.getState().conflictDrawerOpen).toBe(true)
  })

  it('setHealthCheckDrawerOpen toggles health check drawer', () => {
    useSprintUI.getState().setHealthCheckDrawerOpen(true)
    expect(useSprintUI.getState().healthCheckDrawerOpen).toBe(true)
  })

  it('setQuickCreateOpen and toggleQuickCreate work', () => {
    useSprintUI.getState().setQuickCreateOpen(true)
    expect(useSprintUI.getState().quickCreateOpen).toBe(true)

    useSprintUI.getState().toggleQuickCreate()
    expect(useSprintUI.getState().quickCreateOpen).toBe(false)

    useSprintUI.getState().toggleQuickCreate()
    expect(useSprintUI.getState().quickCreateOpen).toBe(true)
  })

  it('addGeneratingId adds an id', () => {
    useSprintUI.getState().addGeneratingId('task-1')
    expect(useSprintUI.getState().generatingIds).toContain('task-1')
  })

  it('addGeneratingId does not duplicate an existing id', () => {
    useSprintUI.getState().addGeneratingId('task-1')
    useSprintUI.getState().addGeneratingId('task-1')
    expect(useSprintUI.getState().generatingIds.filter((id) => id === 'task-1')).toHaveLength(1)
  })

  it('removeGeneratingId removes an id', () => {
    useSprintUI.getState().addGeneratingId('task-1')
    useSprintUI.getState().addGeneratingId('task-2')
    useSprintUI.getState().removeGeneratingId('task-1')
    expect(useSprintUI.getState().generatingIds).not.toContain('task-1')
    expect(useSprintUI.getState().generatingIds).toContain('task-2')
  })

  it('setPipelineDensity changes the density', () => {
    useSprintUI.getState().setPipelineDensity('compact')
    expect(useSprintUI.getState().pipelineDensity).toBe('compact')
    useSprintUI.getState().setPipelineDensity('card')
    expect(useSprintUI.getState().pipelineDensity).toBe('card')
  })
})
