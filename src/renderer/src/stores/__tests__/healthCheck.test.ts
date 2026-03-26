import { describe, it, expect, beforeEach } from 'vitest'
import { useHealthCheckStore } from '../healthCheck'

const initialState = {
  stuckTaskIds: [] as string[],
  dismissedIds: [] as string[]
}

describe('healthCheck store', () => {
  beforeEach(() => {
    useHealthCheckStore.setState(initialState)
  })

  it('starts with empty arrays', () => {
    const state = useHealthCheckStore.getState()
    expect(state.stuckTaskIds.length).toBe(0)
    expect(state.dismissedIds.length).toBe(0)
    expect(Array.isArray(state.stuckTaskIds)).toBe(true)
    expect(Array.isArray(state.dismissedIds)).toBe(true)
  })

  it('setStuckTasks populates stuckTaskIds', () => {
    useHealthCheckStore.getState().setStuckTasks(['task-1', 'task-2'])
    const ids = useHealthCheckStore.getState().stuckTaskIds
    expect(ids.includes('task-1')).toBe(true)
    expect(ids.includes('task-2')).toBe(true)
    expect(ids.length).toBe(2)
  })

  it('setStuckTasks replaces previous array', () => {
    useHealthCheckStore.getState().setStuckTasks(['task-1', 'task-2'])
    useHealthCheckStore.getState().setStuckTasks(['task-3'])
    const ids = useHealthCheckStore.getState().stuckTaskIds
    expect(ids.includes('task-1')).toBe(false)
    expect(ids.includes('task-3')).toBe(true)
    expect(ids.length).toBe(1)
  })

  it('setStuckTasks is a no-op when contents are identical (returns same state reference)', () => {
    useHealthCheckStore.getState().setStuckTasks(['task-1'])
    const stateBefore = useHealthCheckStore.getState()
    useHealthCheckStore.getState().setStuckTasks(['task-1'])
    const stateAfter = useHealthCheckStore.getState()
    // Same array reference means no re-render was triggered
    expect(stateAfter.stuckTaskIds).toBe(stateBefore.stuckTaskIds)
  })

  it('dismiss adds taskId to dismissedIds', () => {
    useHealthCheckStore.getState().dismiss('task-1')
    expect(useHealthCheckStore.getState().dismissedIds.includes('task-1')).toBe(true)
  })

  it('dismiss accumulates multiple dismissals', () => {
    useHealthCheckStore.getState().dismiss('task-1')
    useHealthCheckStore.getState().dismiss('task-2')
    const ids = useHealthCheckStore.getState().dismissedIds
    expect(ids.includes('task-1')).toBe(true)
    expect(ids.includes('task-2')).toBe(true)
  })

  it('clearDismissed empties the dismissedIds array', () => {
    useHealthCheckStore.getState().dismiss('task-1')
    useHealthCheckStore.getState().dismiss('task-2')
    useHealthCheckStore.getState().clearDismissed()
    expect(useHealthCheckStore.getState().dismissedIds.length).toBe(0)
  })

  it('clearDismissed does not affect stuckTaskIds', () => {
    useHealthCheckStore.getState().setStuckTasks(['task-1'])
    useHealthCheckStore.getState().dismiss('task-1')
    useHealthCheckStore.getState().clearDismissed()
    expect(useHealthCheckStore.getState().stuckTaskIds.includes('task-1')).toBe(true)
  })
})
