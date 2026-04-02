import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveDependents } from '../resolve-dependents'
import { createDependencyIndex } from '../dependency-index'
import type { DependencyIndex } from '../dependency-index'
import type { TaskDependency } from '../../../shared/types'

// Helpers to build dependency descriptors
const hardDep = (id: string): TaskDependency => ({ id, type: 'hard' })
const softDep = (id: string): TaskDependency => ({ id, type: 'soft' })

// Minimal task shape used by resolveDependents
type MockTask = {
  id: string
  status: string
  depends_on: TaskDependency[] | null
}

function makeIndex(dependentsMap: Record<string, string[]>): DependencyIndex {
  const TERMINAL = new Set(['done', 'cancelled', 'failed', 'error'])
  return {
    rebuild: () => {},
    getDependents(taskId: string): Set<string> {
      return new Set(dependentsMap[taskId] ?? [])
    },
    areDependenciesSatisfied(
      _taskId: string,
      deps: TaskDependency[],
      getStatus: (id: string) => string | undefined
    ): { satisfied: boolean; blockedBy: string[] } {
      const blockedBy: string[] = []
      for (const dep of deps) {
        const status = getStatus(dep.id)
        if (dep.type === 'hard') {
          if (status !== 'done') blockedBy.push(dep.id)
        } else {
          if (!status || !TERMINAL.has(status)) blockedBy.push(dep.id)
        }
      }
      return { satisfied: blockedBy.length === 0, blockedBy }
    }
  }
}

describe('resolveDependents', () => {
  let updateTask: (id: string, patch: Record<string, unknown>) => unknown

  beforeEach(() => {
    updateTask = vi.fn().mockReturnValue(undefined)
  })

  it('does nothing when task has no dependents', async () => {
    const index = makeIndex({})
    const getTask = vi.fn()

    resolveDependents('A', 'done', index, getTask, updateTask)

    expect(getTask).not.toHaveBeenCalled()
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('unblocks dependent when hard dep completes as done', async () => {
    const index = makeIndex({ A: ['B'] })
    const tasks: Record<string, MockTask> = {
      A: { id: 'A', status: 'done', depends_on: null },
      B: { id: 'B', status: 'blocked', depends_on: [hardDep('A')] }
    }
    const getTask = vi.fn().mockImplementation((id: string) => tasks[id] ?? null)

    resolveDependents('A', 'done', index, getTask, updateTask)

    expect(updateTask).toHaveBeenCalledWith('B', { status: 'queued' })
  })

  it('keeps dependent blocked when hard dep fails (updates blocking notes)', async () => {
    const index = makeIndex({ A: ['B'] })
    const tasks: Record<string, MockTask> = {
      A: { id: 'A', status: 'failed', depends_on: null },
      B: { id: 'B', status: 'blocked', depends_on: [hardDep('A')] }
    }
    const getTask = vi.fn().mockImplementation((id: string) => tasks[id] ?? null)

    resolveDependents('A', 'failed', index, getTask, updateTask)

    // Task stays blocked but auto-block notes are updated
    expect(updateTask).toHaveBeenCalledWith('B', { notes: '[auto-block] Blocked by: A' })
  })

  it('keeps dependent blocked when hard dep is cancelled (updates blocking notes)', async () => {
    const index = makeIndex({ A: ['B'] })
    const tasks: Record<string, MockTask> = {
      A: { id: 'A', status: 'cancelled', depends_on: null },
      B: { id: 'B', status: 'blocked', depends_on: [hardDep('A')] }
    }
    const getTask = vi.fn().mockImplementation((id: string) => tasks[id] ?? null)

    resolveDependents('A', 'cancelled', index, getTask, updateTask)

    // Task stays blocked but auto-block notes are updated
    expect(updateTask).toHaveBeenCalledWith('B', { notes: '[auto-block] Blocked by: A' })
  })

  it('unblocks dependent when soft dep fails', async () => {
    const index = makeIndex({ A: ['B'] })
    const tasks: Record<string, MockTask> = {
      A: { id: 'A', status: 'failed', depends_on: null },
      B: { id: 'B', status: 'blocked', depends_on: [softDep('A')] }
    }
    const getTask = vi.fn().mockImplementation((id: string) => tasks[id] ?? null)

    resolveDependents('A', 'failed', index, getTask, updateTask)

    expect(updateTask).toHaveBeenCalledWith('B', { status: 'queued' })
  })

  it('skips non-blocked dependents', async () => {
    const index = makeIndex({ A: ['B'] })
    const tasks: Record<string, MockTask> = {
      A: { id: 'A', status: 'done', depends_on: null },
      B: { id: 'B', status: 'active', depends_on: [hardDep('A')] }
    }
    const getTask = vi.fn().mockImplementation((id: string) => tasks[id] ?? null)

    resolveDependents('A', 'done', index, getTask, updateTask)

    expect(updateTask).not.toHaveBeenCalled()
  })

  it('fan-in: does not unblock when only some deps are satisfied (updates blocking notes)', async () => {
    // C depends on A (hard) and B (hard); A is done but B is still active
    const index = makeIndex({ A: ['C'], B: ['C'] })
    const tasks: Record<string, MockTask> = {
      A: { id: 'A', status: 'done', depends_on: null },
      B: { id: 'B', status: 'active', depends_on: null },
      C: { id: 'C', status: 'blocked', depends_on: [hardDep('A'), hardDep('B')] }
    }
    const getTask = vi.fn().mockImplementation((id: string) => tasks[id] ?? null)

    resolveDependents('A', 'done', index, getTask, updateTask)

    // C stays blocked but auto-block notes are updated with remaining blocker
    expect(updateTask).toHaveBeenCalledWith('C', { notes: '[auto-block] Blocked by: B' })
  })

  it('fan-in: unblocks when last dep is satisfied', async () => {
    // C depends on A (hard) and B (hard); A is already done, B just finished done
    const index = makeIndex({ B: ['C'] })
    const tasks: Record<string, MockTask> = {
      A: { id: 'A', status: 'done', depends_on: null },
      B: { id: 'B', status: 'done', depends_on: null },
      C: { id: 'C', status: 'blocked', depends_on: [hardDep('A'), hardDep('B')] }
    }
    const getTask = vi.fn().mockImplementation((id: string) => tasks[id] ?? null)

    resolveDependents('B', 'done', index, getTask, updateTask)

    expect(updateTask).toHaveBeenCalledWith('C', { status: 'queued' })
  })

  it('mixed: hard done + soft failed = satisfied', async () => {
    const index = makeIndex({ A: ['C'], B: ['C'] })
    const tasks: Record<string, MockTask> = {
      A: { id: 'A', status: 'done', depends_on: null },
      B: { id: 'B', status: 'failed', depends_on: null },
      C: { id: 'C', status: 'blocked', depends_on: [hardDep('A'), softDep('B')] }
    }
    const getTask = vi.fn().mockImplementation((id: string) => tasks[id] ?? null)

    // Completing B (soft, failed) is the final trigger
    resolveDependents('B', 'failed', index, getTask, updateTask)

    expect(updateTask).toHaveBeenCalledWith('C', { status: 'queued' })
  })

  it('handles getTask returning null gracefully', async () => {
    const index = makeIndex({ A: ['B'] })
    // getTask returns null for B (task not found)
    const getTask = vi.fn().mockReturnValue(null)

    expect(() => resolveDependents('A', 'done', index, getTask, updateTask)).not.toThrow()

    expect(updateTask).not.toHaveBeenCalled()
  })

  it('skips dependents that are not in blocked status', async () => {
    const index = createDependencyIndex()
    index.rebuild([{ id: 'A', depends_on: [{ id: 'B', type: 'hard' }] }])
    const getTask = vi
      .fn()
      .mockReturnValue({ id: 'A', status: 'done', depends_on: [{ id: 'B', type: 'hard' }] })
    const update = vi.fn()

    resolveDependents('B', 'done', index, getTask, update)
    expect(update).not.toHaveBeenCalled() // A is 'done', not 'blocked'
  })

  it('handles getTask throwing without crashing', async () => {
    const index = createDependencyIndex()
    index.rebuild([{ id: 'A', depends_on: [{ id: 'B', type: 'hard' }] }])
    const getTask = vi.fn().mockImplementation(() => { throw new Error('DB error'); })
    const update = vi.fn()

    resolveDependents('B', 'done', index, getTask, update)
    expect(update).not.toHaveBeenCalled()
  })

  it('handles updateTask throwing during unblock without crashing', async () => {
    const index = createDependencyIndex()
    index.rebuild([
      { id: 'A', depends_on: [{ id: 'B', type: 'hard' }] },
      { id: 'C', depends_on: [{ id: 'B', type: 'soft' }] }
    ])
    // B is the completedTaskId so its status is seeded in the cache;
    // getTask is only called once per dependent (A and C), not for B itself.
    const getTask = vi
      .fn()
      .mockReturnValueOnce({
        id: 'A',
        status: 'blocked',
        depends_on: [{ id: 'B', type: 'hard' }]
      })
      .mockReturnValueOnce({
        id: 'C',
        status: 'blocked',
        depends_on: [{ id: 'B', type: 'soft' }]
      })
    const update = vi.fn().mockRejectedValueOnce(new Error('DB error')).mockReturnValueOnce(null)

    resolveDependents('B', 'done', index, getTask, update)
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('treats deleted dependency as satisfied', async () => {
    const index = createDependencyIndex()
    index.rebuild([
      {
        id: 'A',
        depends_on: [
          { id: 'B', type: 'hard' },
          { id: 'DELETED', type: 'hard' }
        ]
      }
    ])
    const getTask = vi.fn().mockImplementation((id: string) => {
      if (id === 'A')
        return {
          id: 'A',
          status: 'blocked',
          depends_on: [
            { id: 'B', type: 'hard' },
            { id: 'DELETED', type: 'hard' }
          ]
        }
      if (id === 'B') return { id: 'B', status: 'done', depends_on: null }
      return null
    })
    const update = vi.fn()

    resolveDependents('B', 'done', index, getTask, update)
    expect(update).toHaveBeenCalledWith('A', { status: 'queued' })
  })
})
