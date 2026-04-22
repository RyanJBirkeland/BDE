import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'

// Stub diff-snapshot capture so the test never shells out to git.
vi.mock('../diff-snapshot', () => ({
  captureDiffSnapshot: vi.fn().mockResolvedValue(null)
}))

import { transitionToReview } from '../review-transition'

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function makeRepo(): IAgentTaskRepository & {
  updateTask: ReturnType<typeof vi.fn>
  getTask: ReturnType<typeof vi.fn>
} {
  return {
    getTask: vi.fn().mockReturnValue({
      id: 't-1',
      started_at: new Date(Date.now() - 1000).toISOString()
    }),
    updateTask: vi.fn().mockReturnValue(null),
    getQueuedTasks: vi.fn(),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    getOrphanedTasks: vi.fn(),
    clearStaleClaimedBy: vi.fn().mockReturnValue(0),
    getActiveTaskCount: vi.fn().mockReturnValue(0),
    claimTask: vi.fn(),
    getGroup: vi.fn().mockReturnValue(null),
    getGroupTasks: vi.fn().mockReturnValue([]),
    getGroupsWithDependencies: vi.fn().mockReturnValue([]),
    getQueueStats: vi.fn().mockReturnValue({
      backlog: 0,
      queued: 0,
      active: 0,
      review: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
      error: 0,
      blocked: 0
    })
  } as unknown as IAgentTaskRepository & {
    updateTask: ReturnType<typeof vi.fn>
    getTask: ReturnType<typeof vi.fn>
  }
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

describe('transitionToReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stamps promoted_to_review_at as an ISO8601 timestamp on the updateTask payload', async () => {
    const repo = makeRepo()

    await transitionToReview({
      taskId: 't-1',
      worktreePath: '/tmp/wt/t-1',
      rebaseNote: undefined,
      rebaseBaseSha: undefined,
      rebaseSucceeded: false,
      repo,
      logger
    })

    expect(repo.updateTask).toHaveBeenCalledTimes(1)
    const [taskId, patch] = repo.updateTask.mock.calls[0] as [string, Record<string, unknown>]
    expect(taskId).toBe('t-1')
    expect(patch.status).toBe('review')
    expect(typeof patch.promoted_to_review_at).toBe('string')
    expect(patch.promoted_to_review_at as string).toMatch(ISO8601_RE)
  })

  it('writes promoted_to_review_at alongside other review fields even when no rebase note/diff snapshot are present', async () => {
    const repo = makeRepo()

    await transitionToReview({
      taskId: 't-42',
      worktreePath: '/tmp/wt/t-42',
      rebaseNote: undefined,
      rebaseBaseSha: undefined,
      rebaseSucceeded: false,
      repo,
      logger
    })

    const patch = repo.updateTask.mock.calls[0][1] as Record<string, unknown>
    expect(patch).toMatchObject({
      status: 'review',
      worktree_path: '/tmp/wt/t-42',
      claimed_by: null
    })
    expect(patch.promoted_to_review_at).toMatch(ISO8601_RE)
  })
})
