import { describe, it, expect, beforeEach } from 'vitest'
import { useSprintUI } from '../sprintUI'

const initialState = {
  selectedTaskId: null,
  logDrawerTaskId: null,
  repoFilter: null,
  generatingIds: [] as string[],
}

describe('sprintUI store', () => {
  beforeEach(() => {
    useSprintUI.setState(initialState)
  })

  it('starts with all null values and empty generatingIds', () => {
    const state = useSprintUI.getState()
    expect(state.selectedTaskId).toBeNull()
    expect(state.logDrawerTaskId).toBeNull()
    expect(state.repoFilter).toBeNull()
    expect(state.generatingIds.length).toBe(0)
    expect(Array.isArray(state.generatingIds)).toBe(true)
  })

  it('setSelectedTaskId updates selectedTaskId', () => {
    useSprintUI.getState().setSelectedTaskId('task-123')
    expect(useSprintUI.getState().selectedTaskId).toBe('task-123')
  })

  it('setSelectedTaskId can set to null', () => {
    useSprintUI.getState().setSelectedTaskId('task-123')
    useSprintUI.getState().setSelectedTaskId(null)
    expect(useSprintUI.getState().selectedTaskId).toBeNull()
  })

  it('setLogDrawerTaskId updates logDrawerTaskId', () => {
    useSprintUI.getState().setLogDrawerTaskId('task-456')
    expect(useSprintUI.getState().logDrawerTaskId).toBe('task-456')
  })

  it('setLogDrawerTaskId can set to null', () => {
    useSprintUI.getState().setLogDrawerTaskId('task-456')
    useSprintUI.getState().setLogDrawerTaskId(null)
    expect(useSprintUI.getState().logDrawerTaskId).toBeNull()
  })

  it('setRepoFilter updates repoFilter', () => {
    useSprintUI.getState().setRepoFilter('bde')
    expect(useSprintUI.getState().repoFilter).toBe('bde')
  })

  it('setRepoFilter can clear the filter', () => {
    useSprintUI.getState().setRepoFilter('bde')
    useSprintUI.getState().setRepoFilter(null)
    expect(useSprintUI.getState().repoFilter).toBeNull()
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
})
