import { describe, it, expect, beforeEach } from 'vitest'
import { useSprintSelection } from '../sprintSelection'

beforeEach(() => {
  useSprintSelection.setState({
    selectedTaskId: null,
    selectedTaskIds: new Set<string>(),
    logDrawerTaskId: null,
    drawerOpen: false,
    specPanelOpen: false
  })
})

describe('useSprintSelection', () => {
  it('starts with no selection and closed drawer', () => {
    const state = useSprintSelection.getState()
    expect(state.selectedTaskId).toBeNull()
    expect(state.drawerOpen).toBe(false)
    expect(state.selectedTaskIds.size).toBe(0)
  })

  it('setSelectedTaskId opens the drawer and sets the id', () => {
    useSprintSelection.getState().setSelectedTaskId('task-1')
    const state = useSprintSelection.getState()
    expect(state.selectedTaskId).toBe('task-1')
    expect(state.drawerOpen).toBe(true)
  })

  it('setSelectedTaskId on the already-selected task deselects and closes the drawer', () => {
    useSprintSelection.getState().setSelectedTaskId('task-1')
    useSprintSelection.getState().setSelectedTaskId('task-1')
    const state = useSprintSelection.getState()
    expect(state.selectedTaskId).toBeNull()
    expect(state.drawerOpen).toBe(false)
  })

  it('setSelectedTaskId with null closes the drawer', () => {
    useSprintSelection.getState().setSelectedTaskId('task-1')
    useSprintSelection.getState().setSelectedTaskId(null)
    expect(useSprintSelection.getState().drawerOpen).toBe(false)
  })

  it('clearTaskIfSelected deselects and closes drawer when the id matches', () => {
    useSprintSelection.getState().setSelectedTaskId('task-2')
    useSprintSelection.getState().clearTaskIfSelected('task-2')
    const state = useSprintSelection.getState()
    expect(state.selectedTaskId).toBeNull()
    expect(state.drawerOpen).toBe(false)
  })

  it('clearTaskIfSelected is a no-op when the id does not match', () => {
    useSprintSelection.getState().setSelectedTaskId('task-2')
    useSprintSelection.getState().clearTaskIfSelected('task-99')
    expect(useSprintSelection.getState().selectedTaskId).toBe('task-2')
  })

  it('toggleTaskSelection adds a task to the multi-selection set', () => {
    useSprintSelection.getState().toggleTaskSelection('t1')
    expect(useSprintSelection.getState().selectedTaskIds.has('t1')).toBe(true)
  })

  it('toggleTaskSelection removes a task that is already selected', () => {
    useSprintSelection.getState().toggleTaskSelection('t1')
    useSprintSelection.getState().toggleTaskSelection('t1')
    expect(useSprintSelection.getState().selectedTaskIds.has('t1')).toBe(false)
  })

  it('clearSelection empties the multi-selection set', () => {
    useSprintSelection.getState().toggleTaskSelection('t1')
    useSprintSelection.getState().toggleTaskSelection('t2')
    useSprintSelection.getState().clearSelection()
    expect(useSprintSelection.getState().selectedTaskIds.size).toBe(0)
  })
})
