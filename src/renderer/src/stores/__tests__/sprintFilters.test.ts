import { describe, it, expect, beforeEach } from 'vitest'
import { useSprintFilters } from '../sprintFilters'

beforeEach(() => {
  useSprintFilters.setState({
    statusFilter: 'all',
    repoFilter: null,
    tagFilter: null,
    searchQuery: ''
  })
})

describe('useSprintFilters', () => {
  it('defaults to "all" status filter and null repo/tag filters', () => {
    const state = useSprintFilters.getState()
    expect(state.statusFilter).toBe('all')
    expect(state.repoFilter).toBeNull()
    expect(state.tagFilter).toBeNull()
    expect(state.searchQuery).toBe('')
  })

  it('setStatusFilter updates the status filter', () => {
    useSprintFilters.getState().setStatusFilter('in-progress')
    expect(useSprintFilters.getState().statusFilter).toBe('in-progress')
  })

  it('setRepoFilter updates the repo filter', () => {
    useSprintFilters.getState().setRepoFilter('fleet')
    expect(useSprintFilters.getState().repoFilter).toBe('fleet')
  })

  it('setTagFilter updates the tag filter', () => {
    useSprintFilters.getState().setTagFilter('priority-high')
    expect(useSprintFilters.getState().tagFilter).toBe('priority-high')
  })

  it('setSearchQuery updates the search query', () => {
    useSprintFilters.getState().setSearchQuery('auth bug')
    expect(useSprintFilters.getState().searchQuery).toBe('auth bug')
  })

  it('clearAllFilters resets every filter to its default', () => {
    const { setStatusFilter, setRepoFilter, setTagFilter, setSearchQuery, clearAllFilters } =
      useSprintFilters.getState()
    setStatusFilter('blocked')
    setRepoFilter('myrepo')
    setTagFilter('mytag')
    setSearchQuery('something')

    clearAllFilters()

    const state = useSprintFilters.getState()
    expect(state.statusFilter).toBe('all')
    expect(state.repoFilter).toBeNull()
    expect(state.tagFilter).toBeNull()
    expect(state.searchQuery).toBe('')
  })
})
