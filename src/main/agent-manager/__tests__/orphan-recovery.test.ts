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
import { recoverOrphans } from '../orphan-recovery'
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
    depends_on: null
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
  it('re-queues tasks not in the active agent map', async () => {
    const task = makeTask('task-1')
    getOrphanedTasksMock.mockReturnValue([task])

    const recovered = await recoverOrphans(() => false, mockRepo, logger)

    expect(updateTaskMock).toHaveBeenCalledOnce()
    expect(updateTaskMock).toHaveBeenCalledWith('task-1', {
      status: 'queued',
      claimed_by: null,
      notes:
        'Task was re-queued by orphan recovery. Agent process terminated without completing the task.'
    })
    expect(recovered).toBe(1)
  })

  it('skips tasks still active in the agent map', async () => {
    const task = makeTask('task-2')
    getOrphanedTasksMock.mockReturnValue([task])

    const recovered = await recoverOrphans((taskId) => taskId === 'task-2', mockRepo, logger)

    expect(updateTaskMock).not.toHaveBeenCalled()
    expect(recovered).toBe(0)
  })

  it('returns correct count of recovered tasks when mix of active and orphaned', async () => {
    const activeTask = makeTask('task-active')
    const orphan1 = makeTask('task-orphan-1')
    const orphan2 = makeTask('task-orphan-2')
    getOrphanedTasksMock.mockReturnValue([activeTask, orphan1, orphan2])

    const recovered = await recoverOrphans((taskId) => taskId === 'task-active', mockRepo, logger)

    expect(updateTaskMock).toHaveBeenCalledTimes(2)
    expect(recovered).toBe(2)
  })

  it('returns 0 and does nothing when orphan list is empty', async () => {
    getOrphanedTasksMock.mockReturnValue([])

    const recovered = await recoverOrphans(() => false, mockRepo, logger)

    expect(updateTaskMock).not.toHaveBeenCalled()
    expect(recovered).toBe(0)
  })

  it('clears claimed_by but does not re-queue a task with pr_url', async () => {
    const task = { ...makeTask('task-pr'), pr_url: 'https://github.com/org/repo/pull/42' }
    getOrphanedTasksMock.mockReturnValue([task])

    const recovered = await recoverOrphans(() => false, mockRepo, logger)

    expect(updateTaskMock).toHaveBeenCalledOnce()
    expect(updateTaskMock).toHaveBeenCalledWith('task-pr', { claimed_by: null })
    expect(recovered).toBe(0)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('has PR'))
  })

  it('does not requeue task with pr_status=branch_only (treats like has-PR)', async () => {
    const branchOnlyTask = makeTask('task-branch-only')
    branchOnlyTask.pr_status = 'branch_only' as any
    branchOnlyTask.pr_url = null
    getOrphanedTasksMock.mockReturnValue([branchOnlyTask])

    const count = await recoverOrphans(() => false, mockRepo, logger)

    expect(count).toBe(0)
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
})
