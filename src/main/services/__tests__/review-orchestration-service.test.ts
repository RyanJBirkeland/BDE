/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'util'
import * as orchestration from '../review-orchestration-service'

// Mock all dependencies
vi.mock('node:child_process', () => {
  const execFile = vi.fn() as ReturnType<typeof vi.fn> & { [k: symbol]: unknown }
  execFile[promisify.custom] = vi.fn()
  return { execFile }
})
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    rmSync: vi.fn()
  }
})
vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))
vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/bin' }))
}))
vi.mock('../../settings', () => ({
  getSettingJson: vi.fn()
}))
vi.mock('../review-merge-service')
vi.mock('../review-pr-service')
vi.mock('../sprint-service')
vi.mock('../../lib/post-merge-dedup')
vi.mock('../../lib/git-operations')
vi.mock('../../handlers/sprint-listeners')
vi.mock('../../shared/time', () => ({
  nowIso: vi.fn(() => '2026-04-11T12:00:00Z')
}))

import { execFile } from 'node:child_process'
import { rmSync } from 'node:fs'
import { getSettingJson } from '../../settings'
import * as reviewMerge from '../review-merge-service'
import * as reviewPr from '../review-pr-service'
import * as sprintService from '../sprint-service'
import * as postMergeDedup from '../../lib/post-merge-dedup'
import * as gitOps from '../../lib/git-operations'

const execFileMock = vi.mocked(execFile)

// Helper to get the custom promisify mock
function getCustomMock(): ReturnType<typeof vi.fn> {
  return (execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[promisify.custom]
}

describe('review-orchestration-service', () => {
  const mockEnv = { PATH: '/usr/bin' }
  const mockOnStatusTerminal = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock for getSettingJson (returns repo config)
    vi.mocked(getSettingJson).mockReturnValue([{ name: 'bde', localPath: '/repo/bde' }])

    // Default mock for promisified execFile
    getCustomMock()
      .mockReset()
      .mockImplementation(async (_cmd: string, args: readonly string[], _opts?: any) => {
        // Default: return branch name 'agent/test-branch'
        if (args.includes('--abbrev-ref')) {
          return { stdout: 'agent/test-branch\n', stderr: '' }
        } else if (args.includes('--porcelain')) {
          return { stdout: '', stderr: '' } // clean working tree
        } else if (args.includes('rev-parse')) {
          return { stdout: 'abc123\n', stderr: '' }
        } else {
          return { stdout: '', stderr: '' }
        }
      })
  })

  describe('mergeLocally', () => {
    it('should merge agent branch into current branch and mark task done', async () => {
      const mockTask = {
        id: 'task1',
        repo: 'bde',
        title: 'Test task',
        worktree_path: '/worktree/task1'
      }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      vi.mocked(sprintService.updateTask).mockReturnValue(mockTask as any)
      vi.mocked(reviewMerge.mergeAgentBranch).mockResolvedValue({ success: true })
      vi.mocked(reviewMerge.cleanupWorktree).mockResolvedValue()
      vi.mocked(postMergeDedup.runPostMergeDedup).mockResolvedValue(null)

      const result = await orchestration.mergeLocally({
        taskId: 'task1',
        strategy: 'merge',
        env: mockEnv,
        onStatusTerminal: mockOnStatusTerminal
      })

      expect(result.success).toBe(true)
      expect(reviewMerge.mergeAgentBranch).toHaveBeenCalledWith(
        expect.objectContaining({
          branch: 'agent/test-branch',
          repoPath: '/repo/bde',
          strategy: 'merge',
          taskId: 'task1'
        })
      )
      expect(reviewMerge.cleanupWorktree).toHaveBeenCalledWith(
        '/worktree/task1',
        'agent/test-branch',
        '/repo/bde',
        mockEnv
      )
      expect(mockOnStatusTerminal).toHaveBeenCalledWith('task1', 'done')
    })

    it('should handle merge failure without marking task done', async () => {
      const mockTask = {
        id: 'task1',
        repo: 'bde',
        title: 'Test task',
        worktree_path: '/worktree/task1'
      }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      vi.mocked(reviewMerge.mergeAgentBranch).mockResolvedValue({
        success: false,
        error: 'Merge conflict',
        conflicts: ['file.ts']
      })

      const result = await orchestration.mergeLocally({
        taskId: 'task1',
        strategy: 'merge',
        env: mockEnv,
        onStatusTerminal: mockOnStatusTerminal
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Merge conflict')
      expect(result.conflicts).toEqual(['file.ts'])
      expect(sprintService.updateTask).not.toHaveBeenCalled()
      expect(mockOnStatusTerminal).not.toHaveBeenCalled()
    })
  })

  describe('createPr', () => {
    it('should push branch, create PR, cleanup worktree, and keep task in review', async () => {
      const mockTask = {
        id: 'task2',
        repo: 'bde',
        title: 'Test PR task',
        worktree_path: '/worktree/task2'
      }
      const updatedTask = { ...mockTask, worktree_path: null }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      vi.mocked(sprintService.updateTask).mockReturnValue(updatedTask as any)
      vi.mocked(reviewPr.createPullRequest).mockResolvedValue({
        success: true,
        prUrl: 'https://github.com/org/repo/pull/123',
        prNumber: 123
      })
      vi.mocked(reviewMerge.cleanupWorktree).mockResolvedValue()

      const result = await orchestration.createPr({
        taskId: 'task2',
        title: 'PR title',
        body: 'PR body',
        env: mockEnv,
        onStatusTerminal: mockOnStatusTerminal
      })

      expect(result.success).toBe(true)
      expect(result.prUrl).toBe('https://github.com/org/repo/pull/123')
      expect(reviewPr.createPullRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          worktreePath: '/worktree/task2',
          branch: 'agent/test-branch',
          title: 'PR title',
          body: 'PR body'
        })
      )
      // Task stays in review — worktree_path cleared, no done transition
      expect(sprintService.updateTask).toHaveBeenCalledWith('task2', { worktree_path: null })
      expect(mockOnStatusTerminal).not.toHaveBeenCalled()
    })

    describe('createPr call ordering', () => {
      it('calls notifySprintMutation after the worktree_path update', async () => {
        const callOrder: string[] = []

        vi.mocked(sprintService.getTask).mockReturnValue({
          id: 'task-1',
          repo: 'bde',
          worktree_path: '/wt/task-1',
          status: 'review',
          title: 'Test'
        } as any)

        const updatedTask = { id: 'task-1', worktree_path: null, status: 'review' }
        vi.mocked(sprintService.updateTask).mockReturnValue(updatedTask as any)

        vi.mocked(sprintService.notifySprintMutation).mockImplementation(() => {
          callOrder.push('notify')
        })

        vi.mocked(reviewPr.createPullRequest).mockResolvedValue({
          success: true,
          prUrl: 'https://github.com/owner/repo/pull/1',
          prNumber: 1
        })

        getCustomMock()
          .mockReset()
          .mockImplementation(async (_cmd: string, args: readonly string[]) => {
            if (args.includes('--abbrev-ref')) return { stdout: 'agent/branch\n', stderr: '' }
            return { stdout: '', stderr: '' }
          })

        vi.mocked(reviewMerge.cleanupWorktree).mockResolvedValue(undefined)

        const onStatusTerminal = vi.fn()

        await orchestration.createPr({
          taskId: 'task-1',
          title: 'PR title',
          body: 'PR body',
          env: mockEnv,
          onStatusTerminal
        })

        // notifySprintMutation must be called with the worktree_path-cleared update
        expect(sprintService.notifySprintMutation).toHaveBeenCalledWith('updated', updatedTask)
        expect(callOrder).toEqual(['notify'])
        // onStatusTerminal is not called — task stays in review awaiting PR poller
        expect(onStatusTerminal).not.toHaveBeenCalled()
      })
    })
  })

  describe('requestRevision', () => {
    it('should return task to queued with feedback appended to spec', async () => {
      const mockTask = {
        id: 'task3',
        repo: 'bde',
        spec: '# Original spec\nContent here'
      }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      vi.mocked(sprintService.updateTask).mockReturnValue(mockTask as any)

      const result = await orchestration.requestRevision({
        taskId: 'task3',
        feedback: 'Please add more tests',
        mode: 'resume'
      })

      expect(result.success).toBe(true)
      // updateTask calls now go through repository in executor
    })

    it('should clear agent_run_id in fresh mode', async () => {
      const mockTask = {
        id: 'task4',
        repo: 'bde',
        spec: 'Original spec'
      }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      vi.mocked(sprintService.updateTask).mockReturnValue(mockTask as any)

      await orchestration.requestRevision({
        taskId: 'task4',
        feedback: 'Start fresh',
        mode: 'fresh'
      })

      // updateTask calls now go through repository in executor
    })
  })

  describe('discard', () => {
    it('should cleanup worktree, scratchpad, and mark task cancelled', async () => {
      const mockTask = {
        id: 'task5',
        repo: 'bde',
        worktree_path: '/worktree/task5'
      }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      vi.mocked(sprintService.updateTask).mockReturnValue(mockTask as any)
      vi.mocked(reviewMerge.cleanupWorktree).mockResolvedValue()

      const result = await orchestration.discard({
        taskId: 'task5',
        env: mockEnv,
        onStatusTerminal: mockOnStatusTerminal
      })

      expect(result.success).toBe(true)
      expect(reviewMerge.cleanupWorktree).toHaveBeenCalled()
      expect(rmSync).toHaveBeenCalledWith(expect.stringContaining('task5'), {
        recursive: true,
        force: true
      })
      // updateTask calls now go through repository in executor
      expect(mockOnStatusTerminal).toHaveBeenCalledWith('task5', 'cancelled')
    })
  })

  describe('shipIt', () => {
    it('should merge, push, cleanup, and mark done on success', async () => {
      const mockTask = {
        id: 'task6',
        repo: 'bde',
        title: 'Ship task',
        worktree_path: '/worktree/task6'
      }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      vi.mocked(sprintService.updateTask).mockReturnValue(mockTask as any)
      vi.mocked(gitOps.rebaseOntoMain).mockResolvedValue({ success: true, notes: '' })
      vi.mocked(reviewMerge.executeMergeStrategy).mockResolvedValue({ success: true })
      vi.mocked(reviewMerge.cleanupWorktree).mockResolvedValue()
      vi.mocked(postMergeDedup.runPostMergeDedup).mockResolvedValue(null)

      // Mock git calls for shipIt
      getCustomMock().mockImplementation(
        async (_cmd: string, args: readonly string[], opts: any) => {
          if (opts.cwd === '/worktree/task6' && args.includes('--abbrev-ref')) {
            return { stdout: 'agent/ship-branch\n', stderr: '' }
          } else if (opts.cwd === '/repo/bde' && args.includes('--porcelain')) {
            return { stdout: '', stderr: '' } // clean
          } else if (opts.cwd === '/repo/bde' && args.includes('--abbrev-ref')) {
            return { stdout: 'main\n', stderr: '' } // on main
          } else {
            return { stdout: '', stderr: '' }
          }
        }
      )

      const result = await orchestration.shipIt({
        taskId: 'task6',
        strategy: 'merge',
        env: mockEnv,
        onStatusTerminal: mockOnStatusTerminal
      })

      expect(result.success).toBe(true)
      expect(result.pushed).toBe(true)
      expect(gitOps.rebaseOntoMain).toHaveBeenCalled()
      expect(reviewMerge.executeMergeStrategy).toHaveBeenCalled()
      // updateTask calls now go through repository in executor
      expect(mockOnStatusTerminal).toHaveBeenCalledWith('task6', 'done')
    })

    it('should NOT mark task done if merge fails', async () => {
      const mockTask = {
        id: 'task7',
        repo: 'bde',
        title: 'Failed ship',
        worktree_path: '/worktree/task7'
      }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      vi.mocked(gitOps.rebaseOntoMain).mockResolvedValue({ success: true, notes: '' })
      vi.mocked(reviewMerge.executeMergeStrategy).mockResolvedValue({
        success: false,
        error: 'Merge conflict in file.ts',
        conflicts: ['file.ts']
      })

      // Mock git calls for shipIt
      getCustomMock().mockImplementation(
        async (_cmd: string, args: readonly string[], opts: any) => {
          if (opts.cwd === '/worktree/task7' && args.includes('--abbrev-ref')) {
            return { stdout: 'agent/fail-branch\n', stderr: '' }
          } else if (opts.cwd === '/repo/bde' && args.includes('--porcelain')) {
            return { stdout: '', stderr: '' } // clean
          } else if (opts.cwd === '/repo/bde' && args.includes('--abbrev-ref')) {
            return { stdout: 'main\n', stderr: '' } // on main
          } else {
            return { stdout: '', stderr: '' }
          }
        }
      )

      const result = await orchestration.shipIt({
        taskId: 'task7',
        strategy: 'merge',
        env: mockEnv,
        onStatusTerminal: mockOnStatusTerminal
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Merge conflict in file.ts')
      expect(result.conflicts).toEqual(['file.ts'])
      expect(sprintService.updateTask).not.toHaveBeenCalled()
      expect(mockOnStatusTerminal).not.toHaveBeenCalled()
    })

    it('should NOT mark task done or clean up worktree when git push fails', async () => {
      // Regression: bug where push failure left the squash commit stranded on
      // local main while the handler still cleaned up the worktree, deleted
      // the local branch, and transitioned the task to done — so the UI had
      // no path to retry. Push failure must leave state intact for retry.
      const mockTask = {
        id: 'task-push-fail',
        repo: 'bde',
        title: 'Push fails',
        worktree_path: '/worktree/task-push-fail'
      }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      vi.mocked(gitOps.rebaseOntoMain).mockResolvedValue({ success: true, notes: '' })
      vi.mocked(reviewMerge.executeMergeStrategy).mockResolvedValue({ success: true })
      vi.mocked(reviewMerge.cleanupWorktree).mockResolvedValue()
      vi.mocked(postMergeDedup.runPostMergeDedup).mockResolvedValue(null)

      // Mock git calls: succeed on everything EXCEPT `git push`
      getCustomMock().mockImplementation(
        async (_cmd: string, args: readonly string[], opts: any) => {
          if (args[0] === 'push') {
            throw new Error('remote: rejected — pre-push hook failed')
          }
          if (opts.cwd === '/worktree/task-push-fail' && args.includes('--abbrev-ref')) {
            return { stdout: 'agent/push-fail-branch\n', stderr: '' }
          } else if (opts.cwd === '/repo/bde' && args.includes('--porcelain')) {
            return { stdout: '', stderr: '' } // clean
          } else if (opts.cwd === '/repo/bde' && args.includes('--abbrev-ref')) {
            return { stdout: 'main\n', stderr: '' } // on main
          } else {
            return { stdout: '', stderr: '' }
          }
        }
      )

      const result = await orchestration.shipIt({
        taskId: 'task-push-fail',
        strategy: 'squash',
        env: mockEnv,
        onStatusTerminal: mockOnStatusTerminal
      })

      // Must surface the failure as a real error, not {success: true, pushed: false}
      expect(result.success).toBe(false)
      expect(result.error).toContain('Push failed')

      // Worktree must be preserved so the user can retry
      expect(reviewMerge.cleanupWorktree).not.toHaveBeenCalled()

      // Task must NOT transition to done — stays in review for retry
      expect(sprintService.updateTask).not.toHaveBeenCalledWith(
        'task-push-fail',
        expect.objectContaining({ status: 'done' })
      )
      expect(mockOnStatusTerminal).not.toHaveBeenCalled()
    })

    it('should return error if working tree is dirty', async () => {
      const mockTask = {
        id: 'task8',
        repo: 'bde',
        worktree_path: '/worktree/task8'
      }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      getCustomMock().mockImplementation(
        async (_cmd: string, args: readonly string[], _opts?: any) => {
          if (args.includes('--porcelain')) {
            return { stdout: 'M file.ts\n', stderr: '' } // dirty working tree
          } else if (args.includes('--abbrev-ref')) {
            return { stdout: 'main\n', stderr: '' }
          } else {
            return { stdout: '', stderr: '' }
          }
        }
      )

      const result = await orchestration.shipIt({
        taskId: 'task8',
        strategy: 'merge',
        env: mockEnv,
        onStatusTerminal: mockOnStatusTerminal
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('uncommitted changes')
      expect(sprintService.updateTask).not.toHaveBeenCalled()
    })

    it('should return error if not on main branch', async () => {
      const mockTask = {
        id: 'task9',
        repo: 'bde',
        worktree_path: '/worktree/task9'
      }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      getCustomMock().mockImplementation(
        async (_cmd: string, args: readonly string[], opts: any) => {
          // First call: get branch from worktree
          if (opts.cwd === '/worktree/task9' && args.includes('--abbrev-ref')) {
            return { stdout: 'agent/test\n', stderr: '' }
          }
          // Second call: check working tree status
          else if (args.includes('--porcelain')) {
            return { stdout: '', stderr: '' } // clean
          }
          // Third call: get current branch in main repo
          else if (opts.cwd === '/repo/bde' && args.includes('--abbrev-ref')) {
            return { stdout: 'feature-branch\n', stderr: '' } // NOT main
          } else {
            return { stdout: '', stderr: '' }
          }
        }
      )

      const result = await orchestration.shipIt({
        taskId: 'task9',
        strategy: 'merge',
        env: mockEnv,
        onStatusTerminal: mockOnStatusTerminal
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not "main"')
    })
  })

  describe('rebase', () => {
    it('should rebase agent branch and update task metadata', async () => {
      const mockTask = {
        id: 'task10',
        repo: 'bde',
        worktree_path: '/worktree/task10'
      }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      vi.mocked(sprintService.updateTask).mockReturnValue(mockTask as any)
      vi.mocked(gitOps.rebaseOntoMain).mockResolvedValue({
        success: true,
        notes: '',
        baseSha: 'abc123'
      })

      const result = await orchestration.rebase({
        taskId: 'task10',
        env: mockEnv
      })

      expect(result.success).toBe(true)
      expect(result.baseSha).toBe('abc123')
      expect(gitOps.rebaseOntoMain).toHaveBeenCalledWith(
        '/worktree/task10',
        mockEnv,
        expect.anything()
      )
      // updateTask calls now go through repository in executor
    })

    it('should return conflicts on rebase failure', async () => {
      const mockTask = {
        id: 'task11',
        repo: 'bde',
        worktree_path: '/worktree/task11'
      }
      vi.mocked(sprintService.getTask).mockReturnValue(mockTask as any)
      vi.mocked(gitOps.rebaseOntoMain).mockResolvedValue({
        success: false,
        notes: 'Rebase failed'
      })
      vi.mocked(reviewMerge.extractConflictFiles).mockResolvedValue(['conflict.ts'])
      getCustomMock().mockImplementation(
        async (_cmd: string, args: readonly string[], _opts?: any) => {
          if (args.includes('--diff-filter=U')) {
            return { stdout: 'conflict.ts\n', stderr: '' }
          } else {
            return { stdout: '', stderr: '' }
          }
        }
      )

      const result = await orchestration.rebase({
        taskId: 'task11',
        env: mockEnv
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Rebase failed: Rebase failed')
      expect(result.conflicts).toEqual(['conflict.ts'])
      // updateTask not called on failure
    })
  })

  describe('checkReviewFreshness', () => {
    const taskWithSha = {
      id: 'task-fresh',
      repo: 'bde',
      rebase_base_sha: 'abc123stored'
    }

    it('returns unknown when task not found', async () => {
      vi.mocked(sprintService.getTask).mockReturnValue(null as any)
      const result = await orchestration.checkReviewFreshness('task-fresh', mockEnv)
      expect(result).toEqual({ status: 'unknown' })
    })

    it('returns unknown when task has no rebase_base_sha', async () => {
      vi.mocked(sprintService.getTask).mockReturnValue({ id: 'task-fresh', repo: 'bde' } as any)
      const result = await orchestration.checkReviewFreshness('task-fresh', mockEnv)
      expect(result).toEqual({ status: 'unknown' })
    })

    it('returns unknown when repo config not found', async () => {
      vi.mocked(sprintService.getTask).mockReturnValue(taskWithSha as any)
      vi.mocked(getSettingJson).mockReturnValue([]) // no repos
      const result = await orchestration.checkReviewFreshness('task-fresh', mockEnv)
      expect(result).toEqual({ status: 'unknown' })
    })

    it('returns fresh when origin/main SHA matches stored SHA', async () => {
      vi.mocked(sprintService.getTask).mockReturnValue(taskWithSha as any)
      vi.mocked(getSettingJson).mockReturnValue([{ name: 'bde', localPath: '/repo/bde' }])
      getCustomMock()
        .mockReset()
        .mockImplementation(async (_cmd: string, args: readonly string[]) => {
          if (args[0] === 'fetch') return { stdout: '', stderr: '' }
          if (args[0] === 'rev-parse') return { stdout: 'abc123stored\n', stderr: '' }
          return { stdout: '', stderr: '' }
        })

      const result = await orchestration.checkReviewFreshness('task-fresh', mockEnv)
      expect(result).toEqual({ status: 'fresh', commitsBehind: 0 })
    })

    it('returns stale with commitsBehind when origin/main has advanced', async () => {
      vi.mocked(sprintService.getTask).mockReturnValue(taskWithSha as any)
      vi.mocked(getSettingJson).mockReturnValue([{ name: 'bde', localPath: '/repo/bde' }])
      getCustomMock()
        .mockReset()
        .mockImplementation(async (_cmd: string, args: readonly string[]) => {
          if (args[0] === 'fetch') return { stdout: '', stderr: '' }
          if (args[0] === 'rev-parse') return { stdout: 'newsha999\n', stderr: '' }
          if (args[0] === 'rev-list') return { stdout: '3\n', stderr: '' }
          return { stdout: '', stderr: '' }
        })

      const result = await orchestration.checkReviewFreshness('task-fresh', mockEnv)
      expect(result).toEqual({ status: 'stale', commitsBehind: 3 })
    })

    it('returns unknown when git operations throw', async () => {
      vi.mocked(sprintService.getTask).mockReturnValue(taskWithSha as any)
      vi.mocked(getSettingJson).mockReturnValue([{ name: 'bde', localPath: '/repo/bde' }])
      getCustomMock()
        .mockReset()
        .mockRejectedValue(new Error('git fetch failed'))

      const result = await orchestration.checkReviewFreshness('task-fresh', mockEnv)
      expect(result).toEqual({ status: 'unknown' })
    })
  })

  describe('markShippedOutsideBde', () => {
    const mockTaskStateService = {
      transition: vi.fn().mockResolvedValue(undefined)
    }

    beforeEach(() => {
      mockTaskStateService.transition.mockReset().mockResolvedValue(undefined)
    })

    it('transitions review task to done and returns success', async () => {
      vi.mocked(sprintService.getTask).mockReturnValue({
        id: 'task-ship',
        status: 'review'
      } as any)

      const result = await orchestration.markShippedOutsideBde('task-ship', {
        taskStateService: mockTaskStateService as any
      })

      expect(result).toEqual({ success: true })
      expect(mockTaskStateService.transition).toHaveBeenCalledWith(
        'task-ship',
        'done',
        expect.objectContaining({ caller: 'review:markShippedOutsideBde' })
      )
    })

    it('throws when task is not found', async () => {
      vi.mocked(sprintService.getTask).mockReturnValue(null as any)

      await expect(
        orchestration.markShippedOutsideBde('task-missing', {
          taskStateService: mockTaskStateService as any
        })
      ).rejects.toThrow('Task task-missing not found')
    })

    it('throws when task is not in review status', async () => {
      vi.mocked(sprintService.getTask).mockReturnValue({
        id: 'task-active',
        status: 'active'
      } as any)

      await expect(
        orchestration.markShippedOutsideBde('task-active', {
          taskStateService: mockTaskStateService as any
        })
      ).rejects.toThrow('is not in review status')
    })
  })
})
