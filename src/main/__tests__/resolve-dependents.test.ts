import { describe, it, expect, vi } from 'vitest'
import { resolveDependents } from '../lib/resolve-dependents'
import type { DependencyIndex } from '../services/dependency-service'

function mockIndex(overrides: Partial<DependencyIndex> = {}): DependencyIndex {
  return {
    rebuild: vi.fn(),
    getDependents: vi.fn().mockReturnValue(new Set<string>()),
    areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true, blockedBy: [] }),
    ...overrides
  }
}

function mockTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    title: 'Test',
    status: 'blocked',
    depends_on: [{ id: 'dep-1', type: 'hard' }],
    notes: null,
    ...overrides
  }
}

describe('resolveDependents', () => {
  it('does nothing when no dependents exist', () => {
    const index = mockIndex({ getDependents: vi.fn().mockReturnValue(new Set()) })
    const getTask = vi.fn()
    const updateTask = vi.fn()

    resolveDependents('dep-1', 'done', index, getTask, updateTask)

    expect(getTask).not.toHaveBeenCalled()
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('unblocks a blocked dependent when dependencies are satisfied', () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1'])),
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true, blockedBy: [] })
    })
    const task = mockTask({ id: 'task-1', status: 'blocked' })
    const getTask = vi.fn().mockReturnValue(task)
    const updateTask = vi.fn()

    resolveDependents('dep-1', 'done', index, getTask, updateTask)

    expect(updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ status: 'queued' }))
  })

  it('does not unblock a dependent whose deps are not satisfied', () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1'])),
      areDependenciesSatisfied: vi
        .fn()
        .mockReturnValue({ satisfied: false, blockedBy: ['other-dep'] })
    })
    const task = mockTask({ id: 'task-1', status: 'blocked' })
    const getTask = vi.fn().mockReturnValue(task)
    const updateTask = vi.fn()

    resolveDependents('dep-1', 'done', index, getTask, updateTask)

    // Should update notes (blockedBy), but NOT set status to queued
    const statusCalls = updateTask.mock.calls.filter(
      ([, patch]: [string, Record<string, unknown>]) => patch.status === 'queued'
    )
    expect(statusCalls.length).toBe(0)
  })

  it('updates blocking notes when deps are not satisfied', () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1'])),
      areDependenciesSatisfied: vi
        .fn()
        .mockReturnValue({ satisfied: false, blockedBy: ['other-dep'] })
    })
    const task = mockTask({ id: 'task-1', status: 'blocked' })
    const getTask = vi.fn().mockReturnValue(task)
    const updateTask = vi.fn()

    resolveDependents('dep-1', 'done', index, getTask, updateTask)

    // Should have called updateTask with notes (from buildBlockedNotes)
    expect(updateTask).toHaveBeenCalled()
    const notesCalls = updateTask.mock.calls.filter(
      ([, patch]: [string, Record<string, unknown>]) => 'notes' in patch
    )
    expect(notesCalls.length).toBe(1)
  })

  it('skips dependents that are not in blocked status', () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1']))
    })
    const task = mockTask({ id: 'task-1', status: 'active' })
    const getTask = vi.fn().mockReturnValue(task)
    const updateTask = vi.fn()

    resolveDependents('dep-1', 'done', index, getTask, updateTask)

    expect(updateTask).not.toHaveBeenCalled()
  })

  it('skips dependents with null task', () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1']))
    })
    const getTask = vi.fn().mockReturnValue(null)
    const updateTask = vi.fn()

    resolveDependents('dep-1', 'done', index, getTask, updateTask)

    expect(updateTask).not.toHaveBeenCalled()
  })

  it('skips blocked task with empty depends_on', () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1']))
    })
    const task = mockTask({ id: 'task-1', status: 'blocked', depends_on: [] })
    const getTask = vi.fn().mockReturnValue(task)
    const updateTask = vi.fn()

    resolveDependents('dep-1', 'done', index, getTask, updateTask)

    expect(updateTask).not.toHaveBeenCalled()
  })

  it('skips blocked task with null depends_on', () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1']))
    })
    const task = mockTask({ id: 'task-1', status: 'blocked', depends_on: null })
    const getTask = vi.fn().mockReturnValue(task)
    const updateTask = vi.fn()

    resolveDependents('dep-1', 'done', index, getTask, updateTask)

    expect(updateTask).not.toHaveBeenCalled()
  })

  it('handles multiple dependents independently', () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1', 'task-2'])),
      areDependenciesSatisfied: vi
        .fn()
        .mockReturnValueOnce({ satisfied: true, blockedBy: [] }) // task-1: satisfied
        .mockReturnValueOnce({ satisfied: false, blockedBy: ['other'] }) // task-2: not satisfied
    })
    const getTask = vi
      .fn()
      .mockReturnValueOnce(mockTask({ id: 'task-1', status: 'blocked' }))
      .mockReturnValueOnce(mockTask({ id: 'task-2', status: 'blocked' }))
      // Second call for task-2 notes update (getTask called again inside blockedBy branch)
      .mockReturnValueOnce(mockTask({ id: 'task-2', status: 'blocked' }))
    const updateTask = vi.fn()

    resolveDependents('dep-1', 'done', index, getTask, updateTask)

    // task-1 should be unblocked
    const queuedCalls = updateTask.mock.calls.filter(
      ([, p]: [string, Record<string, unknown>]) => p.status === 'queued'
    )
    expect(queuedCalls.length).toBe(1)
  })

  it('catches and logs errors for individual dependents', () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1']))
    })
    const getTask = vi.fn().mockImplementation(() => {
      throw new Error('DB error')
    })
    const updateTask = vi.fn()
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }

    // Should not throw
    resolveDependents('dep-1', 'done', index, getTask, updateTask, logger as any)

    expect(logger.warn).toHaveBeenCalled()
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('uses completedStatus in status cache for the completed task', () => {
    const index = mockIndex({
      getDependents: vi.fn().mockReturnValue(new Set(['task-1'])),
      areDependenciesSatisfied: vi.fn().mockReturnValue({ satisfied: true, blockedBy: [] })
    })
    const task = mockTask({
      id: 'task-1',
      status: 'blocked',
      depends_on: [{ id: 'dep-1', type: 'hard' }]
    })
    const getTask = vi.fn().mockReturnValue(task)
    const updateTask = vi.fn()

    resolveDependents('dep-1', 'done', index, getTask, updateTask)

    // areDependenciesSatisfied should have been called with a getTaskStatus
    // that returns 'done' for dep-1 without needing to call getTask for it
    const areDepsCall = vi.mocked(index.areDependenciesSatisfied).mock.calls[0]
    const getTaskStatus = areDepsCall[2] as (id: string) => string | undefined
    expect(getTaskStatus('dep-1')).toBe('done')
  })
})

describe('cascade cancellation atomicity', () => {
  it('calls runInTransaction once wrapping all updateTask calls', () => {
    const transactionFn = vi.fn((fn: () => void) => fn())

    const index = mockIndex({
      getDependents: vi.fn((id: string) => {
        if (id === 'dep-1') return new Set(['task-1', 'task-2'])
        return new Set()
      }),
      areDependenciesSatisfied: vi
        .fn()
        .mockReturnValue({ satisfied: false, blockedBy: ['dep-1'] })
    })

    const task1 = mockTask({ id: 'task-1', status: 'blocked', depends_on: [{ id: 'dep-1', type: 'hard' }] })
    const task2 = mockTask({ id: 'task-2', status: 'blocked', depends_on: [{ id: 'dep-1', type: 'hard' }] })
    const getTask = vi.fn((id: string) => {
      if (id === 'task-1') return task1
      if (id === 'task-2') return task2
      if (id === 'dep-1') return mockTask({ id: 'dep-1', status: 'failed', title: 'dep-1', depends_on: [] })
      return null
    })
    const updateTask = vi.fn()

    resolveDependents(
      'dep-1',
      'failed',       // trigger cascade
      index,
      getTask,
      updateTask,
      undefined,
      () => 'cancel', // getSetting returns 'cancel'
      undefined,
      undefined,
      undefined,
      transactionFn   // new parameter
    )

    // Transaction wrapper should be called once for the entire cascade
    expect(transactionFn).toHaveBeenCalledTimes(1)
  })

  it('leaves db consistent when one updateTask throws midway', () => {
    const rollbackCalled = { value: false }
    const transactionFn = vi.fn((fn: () => void) => {
      try {
        fn()
      } catch {
        rollbackCalled.value = true
        throw new Error('Transaction rolled back')
      }
    })

    const index = mockIndex({
      getDependents: vi.fn(() => new Set(['task-1', 'task-2']))
    })

    const getTask = vi.fn((id: string) => {
      if (id === 'dep-1') return mockTask({ id: 'dep-1', status: 'failed', title: 'dep-1', depends_on: [] })
      return mockTask({ id, status: 'blocked', depends_on: [{ id: 'dep-1', type: 'hard' }], notes: null })
    })
    let callCount = 0
    const updateTask = vi.fn(() => {
      callCount++
      if (callCount === 2) throw new Error('DB error on task-2')
    })

    expect(() =>
      resolveDependents('dep-1', 'failed', index, getTask, updateTask, undefined, () => 'cancel', undefined, undefined, undefined, transactionFn)
    ).toThrow('Transaction rolled back')

    expect(rollbackCalled.value).toBe(true)
  })
})
