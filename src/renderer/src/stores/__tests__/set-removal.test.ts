/**
 * Verifies that healthCheck, prConflicts, and sprintUI stores use plain arrays,
 * not Set<string> (which is a Zustand anti-pattern).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useHealthCheckStore } from '../healthCheck'
import { usePrConflictsStore } from '../prConflicts'
import { useSprintUI } from '../sprintUI'

describe('healthCheck store — Set removal', () => {
  beforeEach(() => {
    useHealthCheckStore.setState({ stuckTaskIds: [], dismissedIds: [] })
  })

  it('stuckTaskIds is a plain array, not a Set', () => {
    const { stuckTaskIds } = useHealthCheckStore.getState()
    expect(stuckTaskIds).not.toBeInstanceOf(Set)
    expect(Array.isArray(stuckTaskIds)).toBe(true)
  })

  it('dismissedIds is a plain array, not a Set', () => {
    const { dismissedIds } = useHealthCheckStore.getState()
    expect(dismissedIds).not.toBeInstanceOf(Set)
    expect(Array.isArray(dismissedIds)).toBe(true)
  })

  it('can check membership with .includes()', () => {
    useHealthCheckStore.getState().setStuckTasks(['task-1'])
    const { stuckTaskIds } = useHealthCheckStore.getState()
    expect(stuckTaskIds.includes('task-1')).toBe(true)
    expect(stuckTaskIds.includes('task-2')).toBe(false)
  })

  it('can check length with .length', () => {
    useHealthCheckStore.getState().setStuckTasks(['task-1', 'task-2'])
    expect(useHealthCheckStore.getState().stuckTaskIds.length).toBe(2)
  })
})

describe('prConflicts store — Set removal', () => {
  beforeEach(() => {
    usePrConflictsStore.setState({ conflictingTaskIds: [] })
  })

  it('conflictingTaskIds is a plain array, not a Set', () => {
    const { conflictingTaskIds } = usePrConflictsStore.getState()
    expect(conflictingTaskIds).not.toBeInstanceOf(Set)
    expect(Array.isArray(conflictingTaskIds)).toBe(true)
  })

  it('can check membership with .includes()', () => {
    usePrConflictsStore.getState().setConflicts(['task-a'])
    const { conflictingTaskIds } = usePrConflictsStore.getState()
    expect(conflictingTaskIds.includes('task-a')).toBe(true)
    expect(conflictingTaskIds.includes('task-b')).toBe(false)
  })

  it('can check length with .length', () => {
    usePrConflictsStore.getState().setConflicts(['task-a', 'task-b'])
    expect(usePrConflictsStore.getState().conflictingTaskIds.length).toBe(2)
  })
})

describe('sprintUI store — Set removal', () => {
  beforeEach(() => {
    useSprintUI.setState({ generatingIds: [] })
  })

  it('generatingIds is a plain array, not a Set', () => {
    const { generatingIds } = useSprintUI.getState()
    expect(generatingIds).not.toBeInstanceOf(Set)
    expect(Array.isArray(generatingIds)).toBe(true)
  })

  it('setGeneratingIds updater receives an array', () => {
    useSprintUI.getState().setGeneratingIds((prev) => {
      expect(Array.isArray(prev)).toBe(true)
      expect(prev).not.toBeInstanceOf(Set)
      return [...prev, 'task-x']
    })
    expect(useSprintUI.getState().generatingIds.includes('task-x')).toBe(true)
  })

  it('can check membership with .includes()', () => {
    useSprintUI.getState().setGeneratingIds(() => ['task-1', 'task-2'])
    const { generatingIds } = useSprintUI.getState()
    expect(generatingIds.includes('task-1')).toBe(true)
    expect(generatingIds.includes('task-3')).toBe(false)
  })

  it('can check length with .length', () => {
    useSprintUI.getState().setGeneratingIds(() => ['task-1', 'task-2'])
    expect(useSprintUI.getState().generatingIds.length).toBe(2)
  })
})
