import { describe, it, expect, beforeEach } from 'vitest'
import { usePrConflictsStore } from '../prConflicts'

const initialState = {
  conflictingTaskIds: [] as string[]
}

describe('prConflicts store', () => {
  beforeEach(() => {
    usePrConflictsStore.setState(initialState)
  })

  it('starts with empty conflictingTaskIds', () => {
    const ids = usePrConflictsStore.getState().conflictingTaskIds
    expect(ids.length).toBe(0)
    expect(Array.isArray(ids)).toBe(true)
  })

  it('setConflicts populates conflictingTaskIds', () => {
    usePrConflictsStore.getState().setConflicts(['task-1', 'task-2'])
    const ids = usePrConflictsStore.getState().conflictingTaskIds
    expect(ids.includes('task-1')).toBe(true)
    expect(ids.includes('task-2')).toBe(true)
    expect(ids.length).toBe(2)
  })

  it('setConflicts replaces previous array', () => {
    usePrConflictsStore.getState().setConflicts(['task-1', 'task-2'])
    usePrConflictsStore.getState().setConflicts(['task-3'])
    const ids = usePrConflictsStore.getState().conflictingTaskIds
    expect(ids.includes('task-1')).toBe(false)
    expect(ids.includes('task-3')).toBe(true)
    expect(ids.length).toBe(1)
  })

  it('setConflicts can clear all conflicts', () => {
    usePrConflictsStore.getState().setConflicts(['task-1'])
    usePrConflictsStore.getState().setConflicts([])
    expect(usePrConflictsStore.getState().conflictingTaskIds.length).toBe(0)
  })

  it('smart equality: returns same state reference when contents are identical', () => {
    usePrConflictsStore.getState().setConflicts(['task-1', 'task-2'])
    const stateBefore = usePrConflictsStore.getState()
    usePrConflictsStore.getState().setConflicts(['task-1', 'task-2'])
    const stateAfter = usePrConflictsStore.getState()
    // Same array reference means no re-render was triggered
    expect(stateAfter.conflictingTaskIds).toBe(stateBefore.conflictingTaskIds)
  })

  it('smart equality: creates new array when contents differ', () => {
    usePrConflictsStore.getState().setConflicts(['task-1'])
    const arrRef = usePrConflictsStore.getState().conflictingTaskIds
    usePrConflictsStore.getState().setConflicts(['task-2'])
    expect(usePrConflictsStore.getState().conflictingTaskIds).not.toBe(arrRef)
  })

  it('smart equality: different length triggers update', () => {
    usePrConflictsStore.getState().setConflicts(['task-1'])
    const arrRef = usePrConflictsStore.getState().conflictingTaskIds
    usePrConflictsStore.getState().setConflicts(['task-1', 'task-2'])
    expect(usePrConflictsStore.getState().conflictingTaskIds).not.toBe(arrRef)
  })
})
