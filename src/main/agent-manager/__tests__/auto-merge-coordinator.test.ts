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
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }
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

function makeMockTaskStateService(repo: ReturnType<typeof makeRepo>) {
  return {
    transition: vi.fn(async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
      repo.updateTask(taskId, { status, ...(ctx?.fields ?? {}) })
    })
  }
}

function makeContext(overrides: Partial<AutoMergeContext> = {}): AutoMergeContext {
  const repo = makeRepo()
  return {
    taskId: 'task-1',
    title: 'Test task',
    branch: 'agent/test-task',
    worktreePath: '/tmp/worktrees/task-1',
    repo: repo as unknown as AutoMergeContext['repo'],
    unitOfWork: { runInTransaction: (fn) => fn() },
    logger: makeLogger() as unknown as AutoMergeContext['logger'],
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    taskStateService: makeMockTaskStateService(repo) as unknown as AutoMergeContext['taskStateService'],
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
    it('transitions task to done via TaskStateService on successful merge', async () => {
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
      // transition() is the single entry point for status writes
      expect(ctx.taskStateService.transition).toHaveBeenCalledWith(
        'task-1',
        'done',
        expect.objectContaining({ fields: expect.objectContaining({ worktree_path: null }) })
      )
      // The mock transition delegates to repo.updateTask for test verifiability
      expect(ctx.repo.updateTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: 'done', worktree_path: null })
      )
      // onTaskTerminal is dispatched by TaskStateService's terminal dispatcher — not called directly
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

    it('emits logger.event with auto-merge.status-update-failed when taskStateService.transition throws', async () => {
      const dbError = new Error('db write failed')
      const failingStateService = {
        transition: vi.fn().mockRejectedValue(dbError)
      }
      const ctx = makeContext({
        taskStateService: failingStateService as unknown as AutoMergeContext['taskStateService']
      })

      // evaluateAutoMerge catches the re-throw from finalizeAutoMergeStatus — task stays in review
      await expect(evaluateAutoMerge(ctx)).resolves.toBeUndefined()

      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('COMMIT LANDED ON MAIN but status update failed')
      )
      expect(ctx.logger.event).toHaveBeenCalledWith(
        'auto-merge.status-update-failed',
        expect.objectContaining({ taskId: 'task-1', error: expect.stringContaining('db write failed') })
      )
    })

    it('does not call logger.event on the happy path', async () => {
      const ctx = makeContext()
      await evaluateAutoMerge(ctx)

      expect(ctx.logger.event).not.toHaveBeenCalledWith(
        'auto-merge.status-update-failed',
        expect.anything()
      )
    })
  })
})
