import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../auto-merge-policy', () => ({
  evaluateAutoMergePolicy: vi.fn()
}))

vi.mock('../../lib/git-operations', () => ({
  executeSquashMerge: vi.fn()
}))

vi.mock('../../settings', () => ({
  getSettingJson: vi.fn()
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { evaluateAutoMerge } from '../auto-merge-coordinator'
import type { AutoMergeContext } from '../auto-merge-coordinator'
import { evaluateAutoMergePolicy } from '../auto-merge-policy'
import { executeSquashMerge } from '../../lib/git-operations'
import { getSettingJson } from '../../settings'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    getTask: vi.fn().mockReturnValue({
      id: 'task-1',
      repo: 'bde',
      status: 'review',
      ...overrides
    }),
    updateTask: vi.fn(),
    claimTask: vi.fn(),
    getQueuedTasks: vi.fn(),
    getOrphanedTasks: vi.fn(),
    getTasksWithDependencies: vi.fn(),
    clearStaleClaimedBy: vi.fn(),
    getActiveTaskCount: vi.fn(),
    getGroup: vi.fn(),
    getGroupTasks: vi.fn(),
    getGroupsWithDependencies: vi.fn(),
    listTasksWithOpenPrs: vi.fn()
  }
}

function makeContext(overrides: Partial<AutoMergeContext> = {}): AutoMergeContext {
  return {
    taskId: 'task-1',
    title: 'Test task',
    branch: 'agent/test-task',
    worktreePath: '/tmp/worktrees/task-1',
    repo: makeRepo() as unknown as AutoMergeContext['repo'],
    logger: makeLogger() as unknown as AutoMergeContext['logger'],
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluateAutoMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: settings returns a repo config
    vi.mocked(getSettingJson).mockImplementation((key: string) => {
      if (key === 'repos') return [{ name: 'bde', localPath: '/repos/bde' }]
      if (key === 'autoReview.rules') return [{ name: 'always-merge', condition: 'always' }]
      return null
    })
    vi.mocked(evaluateAutoMergePolicy).mockResolvedValue({
      shouldMerge: true,
      ruleName: 'always-merge',
      cssOnly: false
    })
    vi.mocked(executeSquashMerge).mockResolvedValue('merged')
  })

  describe('early exits', () => {
    it('does nothing when rules list is empty', async () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'autoReview.rules') return []
        if (key === 'repos') return [{ name: 'bde', localPath: '/repos/bde' }]
        return null
      })

      await evaluateAutoMerge(makeContext())

      expect(evaluateAutoMergePolicy).not.toHaveBeenCalled()
      expect(executeSquashMerge).not.toHaveBeenCalled()
    })

    it('does nothing when rules are null', async () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'autoReview.rules') return null
        return null
      })

      await evaluateAutoMerge(makeContext())

      expect(evaluateAutoMergePolicy).not.toHaveBeenCalled()
    })

    it('does nothing when policy says shouldMerge=false', async () => {
      vi.mocked(evaluateAutoMergePolicy).mockResolvedValue({
        shouldMerge: false,
        cssOnly: false
      })

      await evaluateAutoMerge(makeContext())

      expect(executeSquashMerge).not.toHaveBeenCalled()
    })

    it('does nothing when task is not found in repo', async () => {
      const repo = makeRepo()
      repo.getTask.mockReturnValue(null)

      const ctx = makeContext({ repo: repo as unknown as AutoMergeContext['repo'] })
      await evaluateAutoMerge(ctx)

      expect(executeSquashMerge).not.toHaveBeenCalled()
      expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('not found'))
    })

    it('does nothing when repo config not found in settings', async () => {
      vi.mocked(getSettingJson).mockImplementation((key: string) => {
        if (key === 'autoReview.rules') return [{ name: 'always-merge', condition: 'always' }]
        if (key === 'repos') return [{ name: 'other-repo', localPath: '/repos/other' }]
        return null
      })

      const ctx = makeContext()
      await evaluateAutoMerge(ctx)

      expect(executeSquashMerge).not.toHaveBeenCalled()
      expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('"bde" not found'))
    })
  })

  describe('successful merge', () => {
    it('transitions task to done and calls onTaskTerminal on successful merge', async () => {
      const ctx = makeContext()
      await evaluateAutoMerge(ctx)

      expect(executeSquashMerge).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-1',
          branch: 'agent/test-task',
          worktreePath: '/tmp/worktrees/task-1',
          repoPath: '/repos/bde',
          title: 'Test task'
        })
      )
      expect(ctx.repo.updateTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'done', worktree_path: null })
      )
      expect(ctx.onTaskTerminal).toHaveBeenCalledWith('task-1', 'done')
    })

    it('logs success after merge', async () => {
      const ctx = makeContext()
      await evaluateAutoMerge(ctx)

      expect(ctx.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('auto-merged successfully')
      )
    })
  })

  describe('non-fatal failure paths', () => {
    it('logs warning and leaves task in review when main is dirty', async () => {
      vi.mocked(executeSquashMerge).mockResolvedValue('dirty-main')

      const ctx = makeContext()
      await evaluateAutoMerge(ctx)

      expect(ctx.repo.updateTask).not.toHaveBeenCalled()
      expect(ctx.onTaskTerminal).not.toHaveBeenCalled()
      expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('uncommitted changes'))
    })

    it('logs error and leaves task in review when merge fails', async () => {
      vi.mocked(executeSquashMerge).mockResolvedValue('failed')

      const ctx = makeContext()
      await evaluateAutoMerge(ctx)

      expect(ctx.repo.updateTask).not.toHaveBeenCalled()
      expect(ctx.onTaskTerminal).not.toHaveBeenCalled()
      expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('auto-merge failed'))
    })

    it('does not re-throw when evaluateAutoMergePolicy throws — task stays in review', async () => {
      vi.mocked(evaluateAutoMergePolicy).mockRejectedValue(new Error('policy check failed'))

      const ctx = makeContext()
      await expect(evaluateAutoMerge(ctx)).resolves.toBeUndefined()

      expect(ctx.repo.updateTask).not.toHaveBeenCalled()
      expect(ctx.onTaskTerminal).not.toHaveBeenCalled()
      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Auto-merge check failed')
      )
    })

    it('does not re-throw when executeSquashMerge throws — task stays in review', async () => {
      vi.mocked(executeSquashMerge).mockRejectedValue(new Error('git merge failed'))

      const ctx = makeContext()
      await expect(evaluateAutoMerge(ctx)).resolves.toBeUndefined()

      expect(ctx.onTaskTerminal).not.toHaveBeenCalled()
      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Auto-merge check failed')
      )
    })
  })
})
