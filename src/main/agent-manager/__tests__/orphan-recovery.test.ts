import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../data/sprint-queries', () => ({
  getOrphanedTasks: vi.fn(),
  updateTask: vi.fn(),
  forceUpdateTask: vi.fn()
}))

vi.mock('../../agent-history', () => ({
  reconcileRunningAgentRuns: vi.fn().mockReturnValue(2)
}))

import { getOrphanedTasks, updateTask } from '../../data/sprint-queries'
import { recoverOrphans, MAX_ORPHAN_RECOVERY_COUNT } from '../orphan-recovery'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { SprintTask } from '../../../shared/types'

const getOrphanedTasksMock = vi.mocked(getOrphanedTasks)
const updateTaskMock = vi.mocked(updateTask)

const mockRepo: IAgentTaskRepository = {
  getTask: vi.fn(),
  updateTask: (...args: [string, Record<string, unknown>]) => (updateTask as any)(...args),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn().mockReturnValue([]),
  getOrphanedTasks: (...args: [string]) => (getOrphanedTasks as any)(...args),
  clearStaleClaimedBy: vi.fn().mockReturnValue(0),
  getActiveTaskCount: vi.fn().mockReturnValue(0),
  claimTask: vi.fn(),
  getGroup: vi.fn().mockReturnValue(null),
  getGroupTasks: vi.fn().mockReturnValue([]),
  getGroupsWithDependencies: vi.fn().mockReturnValue([])
}

function makeTask(id: string, title = `Task ${id}`): SprintTask {
  return {
    id,
    title,
    status: 'active',
    claimed_by: 'bde-embedded',
    depends_on: null,
    orphan_recovery_count: 0
  } as SprintTask
}

const logger = {
  info: vi.fn(),
  warn: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  updateTaskMock.mockReturnValue(null)
})

describe('recoverOrphans', () => {
  it('re-queues tasks not in the active agent map and returns them in recovered', async () => {
    const task = makeTask('task-1')
    getOrphanedTasksMock.mockReturnValue([task])

    const result = await recoverOrphans(() => false, mockRepo, logger)

    expect(updateTaskMock).toHaveBeenCalledOnce()
    expect(updateTaskMock).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'queued', claimed_by: null, orphan_recovery_count: 1 })
    )
    expect(result.recovered).toEqual(['task-1'])
    expect(result.exhausted).toEqual([])
  })

  it('skips tasks still active in the agent map', async () => {
    const task = makeTask('task-2')
    getOrphanedTasksMock.mockReturnValue([task])

    const result = await recoverOrphans((taskId) => taskId === 'task-2', mockRepo, logger)

    expect(updateTaskMock).not.toHaveBeenCalled()
    expect(result.recovered).toEqual([])
    expect(result.exhausted).toEqual([])
  })

  it('returns correct lists when mix of active and orphaned tasks', async () => {
    const activeTask = makeTask('task-active')
    const orphan1 = makeTask('task-orphan-1')
    const orphan2 = makeTask('task-orphan-2')
    getOrphanedTasksMock.mockReturnValue([activeTask, orphan1, orphan2])

    const result = await recoverOrphans((taskId) => taskId === 'task-active', mockRepo, logger)

    expect(updateTaskMock).toHaveBeenCalledTimes(2)
    expect(result.recovered).toEqual(['task-orphan-1', 'task-orphan-2'])
    expect(result.exhausted).toEqual([])
  })

  it('returns empty lists when orphan list is empty', async () => {
    getOrphanedTasksMock.mockReturnValue([])

    const result = await recoverOrphans(() => false, mockRepo, logger)

    expect(updateTaskMock).not.toHaveBeenCalled()
    expect(result.recovered).toEqual([])
    expect(result.exhausted).toEqual([])
  })

  it('clears claimed_by but does not re-queue a task with pr_url', async () => {
    const task = { ...makeTask('task-pr'), pr_url: 'https://github.com/org/repo/pull/42' }
    getOrphanedTasksMock.mockReturnValue([task])

    const result = await recoverOrphans(() => false, mockRepo, logger)

    expect(updateTaskMock).toHaveBeenCalledOnce()
    expect(updateTaskMock).toHaveBeenCalledWith('task-pr', { claimed_by: null })
    expect(result.recovered).toEqual([])
    expect(result.exhausted).toEqual([])
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('has PR'))
  })

  it('does not requeue task with pr_status=branch_only (treats like has-PR)', async () => {
    const branchOnlyTask = makeTask('task-branch-only')
    branchOnlyTask.pr_status = 'branch_only' as any
    branchOnlyTask.pr_url = null
    getOrphanedTasksMock.mockReturnValue([branchOnlyTask])

    const result = await recoverOrphans(() => false, mockRepo, logger)

    expect(result.recovered).toEqual([])
    expect(updateTaskMock).toHaveBeenCalledWith('task-branch-only', { claimed_by: null })
  })

  it('calls reconcileRunningAgentRuns and logs stale count', async () => {
    getOrphanedTasksMock.mockReturnValue([])

    const isActive = (): boolean => false
    await recoverOrphans(isActive, mockRepo, logger)

    const { reconcileRunningAgentRuns } = await import('../../agent-history')
    expect(reconcileRunningAgentRuns).toHaveBeenCalledWith(isActive)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Reconciled 2 stale'))
  })

  describe('recovery cap', () => {
    it('increments orphan_recovery_count and re-queues a task under the cap', async () => {
      const task = { ...makeTask('task-under-cap'), orphan_recovery_count: 1 }
      getOrphanedTasksMock.mockReturnValue([task])

      const result = await recoverOrphans(() => false, mockRepo, logger)

      expect(updateTaskMock).toHaveBeenCalledWith(
        'task-under-cap',
        expect.objectContaining({ status: 'queued', orphan_recovery_count: 2 })
      )
      expect(result.recovered).toEqual(['task-under-cap'])
      expect(result.exhausted).toEqual([])
    })

    it('marks a task error when orphan_recovery_count equals MAX_ORPHAN_RECOVERY_COUNT', async () => {
      const task = {
        ...makeTask('task-at-cap'),
        orphan_recovery_count: MAX_ORPHAN_RECOVERY_COUNT
      }
      getOrphanedTasksMock.mockReturnValue([task])

      const result = await recoverOrphans(() => false, mockRepo, logger)

      expect(updateTaskMock).toHaveBeenCalledWith(
        'task-at-cap',
        expect.objectContaining({
          status: 'error',
          failure_reason: 'exhausted: orphan recovery cap reached'
        })
      )
      expect(result.exhausted).toEqual(['task-at-cap'])
      expect(result.recovered).toEqual([])
    })

    it('does not re-queue an exhausted task', async () => {
      const task = {
        ...makeTask('task-exhausted'),
        orphan_recovery_count: MAX_ORPHAN_RECOVERY_COUNT
      }
      getOrphanedTasksMock.mockReturnValue([task])

      await recoverOrphans(() => false, mockRepo, logger)

      const calls = updateTaskMock.mock.calls
      expect(calls.length).toBe(1)
      // Must not set status=queued
      expect(calls[0][1]).not.toMatchObject({ status: 'queued' })
    })

    it('routes exhausted path through TaskStateService.transition when injected', async () => {
      const task = {
        ...makeTask('task-routed'),
        orphan_recovery_count: MAX_ORPHAN_RECOVERY_COUNT
      }
      getOrphanedTasksMock.mockReturnValue([task])
      const transition = vi.fn().mockResolvedValue(undefined)
      const fakeStateService = { transition } as unknown as Parameters<typeof recoverOrphans>[3]

      const result = await recoverOrphans(() => false, mockRepo, logger, fakeStateService)

      expect(transition).toHaveBeenCalledWith(
        'task-routed',
        'error',
        expect.objectContaining({
          fields: expect.objectContaining({
            failure_reason: 'exhausted: orphan recovery cap reached'
          }),
          caller: 'orphan-recovery'
        })
      )
      // Direct repo.updateTask must not be used for the exhausted write.
      expect(updateTaskMock).not.toHaveBeenCalled()
      expect(result.exhausted).toEqual(['task-routed'])
    })

    it('handles undefined orphan_recovery_count as 0', async () => {
      const task = { ...makeTask('task-undefined-count') }
      delete (task as any).orphan_recovery_count
      getOrphanedTasksMock.mockReturnValue([task])

      const result = await recoverOrphans(() => false, mockRepo, logger)

      expect(updateTaskMock).toHaveBeenCalledWith(
        'task-undefined-count',
        expect.objectContaining({ orphan_recovery_count: 1 })
      )
      expect(result.recovered).toEqual(['task-undefined-count'])
    })
  })
})
