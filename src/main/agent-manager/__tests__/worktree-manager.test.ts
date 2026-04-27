import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'

vi.mock('../worktree', () => ({
  pruneStaleWorktrees: vi.fn()
}))

import { checkIsReviewTask, runPruneLoop, type WorktreeManagerDeps } from '../worktree-manager'
import { pruneStaleWorktrees } from '../worktree'

function makeRepo(taskStatus?: string): IAgentTaskRepository {
  return {
    getTask: vi.fn().mockReturnValue(taskStatus ? { id: 'task-1', status: taskStatus } : null),
    updateTask: vi.fn().mockResolvedValue(null),
    claimTask: vi.fn().mockResolvedValue(null),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    releaseTask: vi.fn().mockResolvedValue(null),
    listActiveAgentRuns: vi.fn().mockReturnValue([])
  } as unknown as IAgentTaskRepository
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

describe('checkIsReviewTask', () => {
  it('returns true when task status is review', () => {
    const repo = makeRepo('review')
    expect(checkIsReviewTask('task-1', repo)).toBe(true)
  })

  it('returns false when task status is active', () => {
    const repo = makeRepo('active')
    expect(checkIsReviewTask('task-1', repo)).toBe(false)
  })

  it('returns false when task is not found', () => {
    const repo = makeRepo()
    expect(checkIsReviewTask('task-1', repo)).toBe(false)
  })

  it('returns false when getTask throws', () => {
    const repo = makeRepo()
    vi.mocked(repo.getTask).mockImplementation(() => {
      throw new Error('DB error')
    })
    expect(checkIsReviewTask('task-1', repo)).toBe(false)
  })
})

describe('runPruneLoop', () => {
  let deps: WorktreeManagerDeps

  beforeEach(() => {
    vi.clearAllMocks()
    deps = {
      worktreeBase: '/tmp/worktrees',
      repo: makeRepo(),
      logger: makeLogger(),
      isActiveAgent: vi.fn().mockReturnValue(false),
      isReviewTask: vi.fn().mockReturnValue(false)
    }
  })

  it('calls pruneStaleWorktrees with the correct arguments', async () => {
    vi.mocked(pruneStaleWorktrees).mockResolvedValue(undefined)
    await runPruneLoop(deps)
    expect(pruneStaleWorktrees).toHaveBeenCalledWith(
      deps.worktreeBase,
      deps.isActiveAgent,
      deps.logger,
      deps.isReviewTask
    )
  })

  it('propagates errors from pruneStaleWorktrees (no internal catch)', async () => {
    const err = new Error('prune failed')
    vi.mocked(pruneStaleWorktrees).mockRejectedValue(err)
    await expect(runPruneLoop(deps)).rejects.toThrow('prune failed')
  })
})
