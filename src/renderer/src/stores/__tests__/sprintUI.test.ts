import { describe, it, expect, beforeEach } from 'vitest'
import { useSprintUI } from '../sprintUI'

const initialState = {
  selectedTaskId: null,
  logDrawerTaskId: null,
  repoFilter: null,
  generatingIds: [] as string[],
  selectedTaskIds: [] as string[],
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

  // --- Bulk selection tests ---

  it('starts with empty selectedTaskIds', () => {
    const state = useSprintUI.getState()
    expect(state.selectedTaskIds).toEqual([])
  })

  it('toggleTaskSelection adds task id when not present', () => {
    useSprintUI.getState().toggleTaskSelection('task-1')
    expect(useSprintUI.getState().selectedTaskIds).toEqual(['task-1'])
  })

  it('toggleTaskSelection removes task id when present', () => {
    useSprintUI.getState().toggleTaskSelection('task-1')
    useSprintUI.getState().toggleTaskSelection('task-1')
    expect(useSprintUI.getState().selectedTaskIds).toEqual([])
  })

  it('toggleTaskSelection can toggle multiple tasks', () => {
    useSprintUI.getState().toggleTaskSelection('task-1')
    useSprintUI.getState().toggleTaskSelection('task-2')
    expect(useSprintUI.getState().selectedTaskIds).toEqual(['task-1', 'task-2'])
  })

  it('selectRange selects all tasks between fromId and toId', () => {
    const taskList = ['task-1', 'task-2', 'task-3', 'task-4', 'task-5']
    useSprintUI.getState().selectRange('task-2', 'task-4', taskList)
    expect(useSprintUI.getState().selectedTaskIds).toEqual(['task-2', 'task-3', 'task-4'])
  })

  it('selectRange works in reverse order', () => {
    const taskList = ['task-1', 'task-2', 'task-3', 'task-4', 'task-5']
    useSprintUI.getState().selectRange('task-4', 'task-2', taskList)
    expect(useSprintUI.getState().selectedTaskIds).toEqual(['task-2', 'task-3', 'task-4'])
  })

  it('selectRange selects single task if fromId equals toId', () => {
    const taskList = ['task-1', 'task-2', 'task-3']
    useSprintUI.getState().selectRange('task-2', 'task-2', taskList)
    expect(useSprintUI.getState().selectedTaskIds).toEqual(['task-2'])
  })

  it('selectRange handles fromId not in list', () => {
    const taskList = ['task-1', 'task-2', 'task-3']
    useSprintUI.getState().selectRange('invalid-id', 'task-2', taskList)
    expect(useSprintUI.getState().selectedTaskIds).toEqual([])
  })

  it('selectRange handles toId not in list', () => {
    const taskList = ['task-1', 'task-2', 'task-3']
    useSprintUI.getState().selectRange('task-1', 'invalid-id', taskList)
    expect(useSprintUI.getState().selectedTaskIds).toEqual([])
  })

  it('clearSelection clears all selected tasks', () => {
    useSprintUI.getState().toggleTaskSelection('task-1')
    useSprintUI.getState().toggleTaskSelection('task-2')
    useSprintUI.getState().clearSelection()
    expect(useSprintUI.getState().selectedTaskIds).toEqual([])
  })

  it('clearSelection is idempotent', () => {
    useSprintUI.getState().clearSelection()
    useSprintUI.getState().clearSelection()
    expect(useSprintUI.getState().selectedTaskIds).toEqual([])
  })
})
