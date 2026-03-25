import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../data/sprint-queries', () => ({
  getOrphanedTasks: vi.fn(),
  updateTask: vi.fn(),
}))

vi.mock('../../agent-history', () => ({
  finalizeStaleAgentRuns: vi.fn().mockReturnValue(2),
}))

import { getOrphanedTasks, updateTask } from '../../data/sprint-queries'
import { recoverOrphans } from '../orphan-recovery'
import type { SprintTask } from '../../../shared/types'

const getOrphanedTasksMock = vi.mocked(getOrphanedTasks)
const updateTaskMock = vi.mocked(updateTask)

function makeTask(id: string, title = `Task ${id}`): SprintTask {
  return {
    id,
    title,
    status: 'active',
    claimed_by: 'bde-embedded',
    depends_on: null,
  } as SprintTask
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  updateTaskMock.mockResolvedValue(null)
})

describe('recoverOrphans', () => {
  it('re-queues tasks not in the active agent map', async () => {
    const task = makeTask('task-1')
    getOrphanedTasksMock.mockResolvedValue([task])

    const recovered = await recoverOrphans(() => false, logger)

    expect(updateTaskMock).toHaveBeenCalledOnce()
    expect(updateTaskMock).toHaveBeenCalledWith('task-1', {
      status: 'queued',
      claimed_by: null,
    })
    expect(recovered).toBe(1)
  })

  it('skips tasks still active in the agent map', async () => {
    const task = makeTask('task-2')
    getOrphanedTasksMock.mockResolvedValue([task])

    const recovered = await recoverOrphans((taskId) => taskId === 'task-2', logger)

    expect(updateTaskMock).not.toHaveBeenCalled()
    expect(recovered).toBe(0)
  })

  it('returns correct count of recovered tasks when mix of active and orphaned', async () => {
    const activeTask = makeTask('task-active')
    const orphan1 = makeTask('task-orphan-1')
    const orphan2 = makeTask('task-orphan-2')
    getOrphanedTasksMock.mockResolvedValue([activeTask, orphan1, orphan2])

    const recovered = await recoverOrphans((taskId) => taskId === 'task-active', logger)

    expect(updateTaskMock).toHaveBeenCalledTimes(2)
    expect(recovered).toBe(2)
  })

  it('returns 0 and does nothing when orphan list is empty', async () => {
    getOrphanedTasksMock.mockResolvedValue([])

    const recovered = await recoverOrphans(() => false, logger)

    expect(updateTaskMock).not.toHaveBeenCalled()
    expect(recovered).toBe(0)
  })

  it('clears claimed_by but does not re-queue a task with pr_url', async () => {
    const task = { ...makeTask('task-pr'), pr_url: 'https://github.com/org/repo/pull/42' }
    getOrphanedTasksMock.mockResolvedValue([task])

    const recovered = await recoverOrphans(() => false, logger)

    expect(updateTaskMock).toHaveBeenCalledOnce()
    expect(updateTaskMock).toHaveBeenCalledWith('task-pr', { claimed_by: null })
    expect(recovered).toBe(0)
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('has PR'))
  })

  it('calls finalizeStaleAgentRuns and logs stale count', async () => {
    getOrphanedTasksMock.mockResolvedValue([])

    await recoverOrphans(() => false, logger)

    const { finalizeStaleAgentRuns } = await import('../../agent-history')
    expect(finalizeStaleAgentRuns).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Finalized 2 stale'))
  })
})
