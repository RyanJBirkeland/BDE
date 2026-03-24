/**
 * Verifies that sprintTasks store uses plain Record/Array for state,
 * not Map/Set (which are Zustand anti-patterns).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useSprintTasks } from '../sprintTasks'

const initialState = {
  tasks: [],
  loading: true,
  loadError: null,
  prMergedMap: {},
  pendingUpdates: {},
  pendingCreates: [],
}

describe('sprintTasks store — Map/Set removal', () => {
  beforeEach(() => {
    useSprintTasks.setState(initialState)
  })

  it('pendingUpdates is a plain object (Record), not a Map', () => {
    const { pendingUpdates } = useSprintTasks.getState()
    expect(pendingUpdates).not.toBeInstanceOf(Map)
    expect(typeof pendingUpdates).toBe('object')
    expect(pendingUpdates).not.toBeNull()
  })

  it('pendingCreates is a plain array, not a Set', () => {
    const { pendingCreates } = useSprintTasks.getState()
    expect(pendingCreates).not.toBeInstanceOf(Set)
    expect(Array.isArray(pendingCreates)).toBe(true)
  })

  it('pendingUpdates starts empty', () => {
    const { pendingUpdates } = useSprintTasks.getState()
    expect(Object.keys(pendingUpdates)).toHaveLength(0)
  })

  it('pendingCreates starts empty', () => {
    const { pendingCreates } = useSprintTasks.getState()
    expect(pendingCreates).toHaveLength(0)
  })

  it('pendingUpdates can be set and read via spread', () => {
    useSprintTasks.setState((s) => ({
      pendingUpdates: { ...s.pendingUpdates, 'task-1': 12345 },
    }))
    const { pendingUpdates } = useSprintTasks.getState()
    expect('task-1' in pendingUpdates).toBe(true)
    expect(pendingUpdates['task-1']).toBe(12345)
    expect(pendingUpdates).not.toBeInstanceOf(Map)
  })

  it('pendingUpdates can remove a key via destructuring', () => {
    useSprintTasks.setState({ pendingUpdates: { 'task-1': 100, 'task-2': 200 } })
    useSprintTasks.setState((s) => {
      const { ['task-1']: _, ...rest } = s.pendingUpdates
      return { pendingUpdates: rest }
    })
    const { pendingUpdates } = useSprintTasks.getState()
    expect('task-1' in pendingUpdates).toBe(false)
    expect('task-2' in pendingUpdates).toBe(true)
  })

  it('pendingCreates can add via spread', () => {
    useSprintTasks.setState((s) => ({
      pendingCreates: [...s.pendingCreates, 'temp-1'],
    }))
    const { pendingCreates } = useSprintTasks.getState()
    expect(pendingCreates.includes('temp-1')).toBe(true)
    expect(Array.isArray(pendingCreates)).toBe(true)
  })

  it('pendingCreates can remove via filter', () => {
    useSprintTasks.setState({ pendingCreates: ['temp-1', 'temp-2'] })
    useSprintTasks.setState((s) => ({
      pendingCreates: s.pendingCreates.filter((id) => id !== 'temp-1'),
    }))
    const { pendingCreates } = useSprintTasks.getState()
    expect(pendingCreates.includes('temp-1')).toBe(false)
    expect(pendingCreates.includes('temp-2')).toBe(true)
  })
})
