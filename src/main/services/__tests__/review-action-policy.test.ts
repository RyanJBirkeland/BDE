/**
 * Tests for review-action-policy.ts — pure business logic with no I/O mocks.
 */
import { describe, it, expect } from 'vitest'
import { classifyReviewAction } from '../review-action-policy'
import type { SprintTask } from '../../../shared/types/task-types'

const mockTask: Pick<SprintTask, 'id' | 'title' | 'repo' | 'worktree_path' | 'spec' | 'notes' | 'agent_run_id'> = {
  id: 'test-123',
  title: 'Test Task',
  repo: 'test-repo',
  worktree_path: '/tmp/test-worktree',
  spec: '# Test Spec\nOriginal spec content',
  notes: 'Original notes',
  agent_run_id: 'run-456'
}

const mockRepoConfig = {
  localPath: '/path/to/repo',
  githubOwner: 'owner',
  githubRepo: 'repo'
}

describe('classifyReviewAction', () => {
  describe('requestRevision', () => {
    it('should create plan with fresh mode clearing agent_run_id', () => {
      const plan = classifyReviewAction({
        action: 'requestRevision',
        taskId: 'test-123',
        task: mockTask,
        repoConfig: null,
        feedback: 'Please fix the tests',
        revisionMode: 'fresh'
      })

      expect(plan.gitOps).toEqual([])
      expect(plan.terminalStatus).toBeNull()
      expect(plan.errorOnMissingWorktree).toBe(false)
      expect(plan.dedup).toBe(false)
      expect(plan.taskPatch).toMatchObject({
        status: 'queued',
        claimed_by: null,
        notes: '[Revision requested]: Please fix the tests',
        agent_run_id: null, // Fresh mode clears this
        spec: expect.stringContaining('Please fix the tests')
      })
    })

    it('should create plan with resume mode preserving agent_run_id', () => {
      const plan = classifyReviewAction({
        action: 'requestRevision',
        taskId: 'test-123',
        task: mockTask,
        repoConfig: null,
        feedback: 'Add more test coverage',
        revisionMode: 'resume'
      })

      expect(plan.taskPatch?.agent_run_id).toBeUndefined() // Resume mode doesn't set it
      expect(plan.taskPatch).toMatchObject({
        status: 'queued',
        claimed_by: null,
        spec: expect.stringContaining('Add more test coverage')
      })
    })

    it('should append feedback to spec', () => {
      const plan = classifyReviewAction({
        action: 'requestRevision',
        taskId: 'test-123',
        task: mockTask,
        repoConfig: null,
        feedback: 'Fix the linter errors',
        revisionMode: 'resume'
      })

      expect(plan.taskPatch?.spec).toBe(
        '# Test Spec\nOriginal spec content\n\n## Revision Feedback\n\nFix the linter errors'
      )
    })
  })

  describe('discard', () => {
    it('should include cleanup ops when worktree exists', () => {
      const plan = classifyReviewAction({
        action: 'discard',
        taskId: 'test-123',
        task: mockTask,
        repoConfig: mockRepoConfig
      })

      expect(plan.gitOps).toHaveLength(3)
      expect(plan.gitOps[0]).toMatchObject({ type: 'getBranch' })
      expect(plan.gitOps[1]).toMatchObject({ type: 'cleanup' })
      expect(plan.gitOps[2]).toMatchObject({ type: 'scratchpadCleanup' })
      expect(plan.terminalStatus).toBe('cancelled')
      expect(plan.taskPatch).toMatchObject({
        status: 'cancelled',
        worktree_path: null
      })
    })

    it('should skip cleanup when worktree is null', () => {
      const taskWithoutWorktree = { ...mockTask, worktree_path: null }
      const plan = classifyReviewAction({
        action: 'discard',
        taskId: 'test-123',
        task: taskWithoutWorktree,
        repoConfig: mockRepoConfig
      })

      expect(plan.gitOps).toHaveLength(1)
      expect(plan.gitOps[0]).toMatchObject({ type: 'scratchpadCleanup' })
    })
  })

  describe('mergeLocally', () => {
    it('should create plan with correct ops and terminal status', () => {
      const plan = classifyReviewAction({
        action: 'mergeLocally',
        taskId: 'test-123',
        task: mockTask,
        repoConfig: mockRepoConfig,
        strategy: 'squash'
      })

      expect(plan.gitOps).toHaveLength(4)
      expect(plan.gitOps[0]).toMatchObject({ type: 'getBranch' })
      expect(plan.gitOps[1]).toMatchObject({ type: 'merge', strategy: 'squash' })
      expect(plan.gitOps[2]).toMatchObject({ type: 'cssDedup' })
      expect(plan.gitOps[3]).toMatchObject({ type: 'cleanup' })
      expect(plan.terminalStatus).toBe('done')
      expect(plan.dedup).toBe(true)
      expect(plan.taskPatch).toMatchObject({
        status: 'done',
        worktree_path: null
      })
    })

    it('should throw when worktree_path is missing', () => {
      const taskWithoutWorktree = { ...mockTask, worktree_path: null }
      expect(() =>
        classifyReviewAction({
          action: 'mergeLocally',
          taskId: 'test-123',
          task: taskWithoutWorktree,
          repoConfig: mockRepoConfig,
          strategy: 'merge'
        })
      ).toThrow('has no worktree path')
    })

    it('should throw when repoConfig is missing', () => {
      expect(() =>
        classifyReviewAction({
          action: 'mergeLocally',
          taskId: 'test-123',
          task: mockTask,
          repoConfig: null,
          strategy: 'merge'
        })
      ).toThrow('not found in settings')
    })
  })

  describe('shipIt', () => {
    it('should create plan with all git ops in correct order', () => {
      const plan = classifyReviewAction({
        action: 'shipIt',
        taskId: 'test-123',
        task: mockTask,
        repoConfig: mockRepoConfig,
        strategy: 'squash'
      })

      expect(plan.gitOps).toHaveLength(10)
      const opTypes = plan.gitOps.map((op) => op.type)
      expect(opTypes).toEqual([
        'getBranch',
        'checkStatus',
        'checkBranch',
        'fetch',
        'fastForward',
        'rebase',
        'merge',
        'cssDedup',
        'push',
        'cleanup'
      ])
      expect(plan.terminalStatus).toBe('done')
      expect(plan.dedup).toBe(true)
    })

    it('should throw when worktree_path is missing', () => {
      const taskWithoutWorktree = { ...mockTask, worktree_path: null }
      expect(() =>
        classifyReviewAction({
          action: 'shipIt',
          taskId: 'test-123',
          task: taskWithoutWorktree,
          repoConfig: mockRepoConfig,
          strategy: 'squash'
        })
      ).toThrow('has no worktree path')
    })
  })

  describe('rebase', () => {
    it('should create plan with rebase op only', () => {
      const plan = classifyReviewAction({
        action: 'rebase',
        taskId: 'test-123',
        task: mockTask,
        repoConfig: null
      })

      expect(plan.gitOps).toHaveLength(1)
      expect(plan.gitOps[0]).toMatchObject({ type: 'rebase' })
      expect(plan.taskPatch).toBeNull() // baseSha set by executor
      expect(plan.terminalStatus).toBeNull()
      expect(plan.dedup).toBe(false)
    })

    it('should throw when worktree_path is missing', () => {
      const taskWithoutWorktree = { ...mockTask, worktree_path: null }
      expect(() =>
        classifyReviewAction({
          action: 'rebase',
          taskId: 'test-123',
          task: taskWithoutWorktree,
          repoConfig: null
        })
      ).toThrow('has no worktree path')
    })
  })

  describe('createPr', () => {
    it('should create plan with getBranch op', () => {
      const plan = classifyReviewAction({
        action: 'createPr',
        taskId: 'test-123',
        task: mockTask,
        repoConfig: mockRepoConfig,
        prTitle: 'Test PR',
        prBody: 'Test PR body'
      })

      expect(plan.gitOps).toHaveLength(1)
      expect(plan.gitOps[0]).toMatchObject({ type: 'getBranch' })
      expect(plan.terminalStatus).toBe('done')
      expect(plan.dedup).toBe(false)
    })
  })

  describe('validation', () => {
    it('should throw for unknown action', () => {
      expect(() =>
        classifyReviewAction({
          // @ts-expect-error Testing invalid action
          action: 'unknownAction',
          taskId: 'test-123',
          task: mockTask,
          repoConfig: null
        })
      ).toThrow('Unknown action')
    })

    it('should throw when feedback is missing for requestRevision', () => {
      expect(() =>
        classifyReviewAction({
          action: 'requestRevision',
          taskId: 'test-123',
          task: mockTask,
          repoConfig: null,
          feedback: '',
          revisionMode: 'fresh'
        })
      ).toThrow('feedback required')
    })

    it('should throw when strategy is missing for mergeLocally', () => {
      expect(() =>
        classifyReviewAction({
          action: 'mergeLocally',
          taskId: 'test-123',
          task: mockTask,
          repoConfig: mockRepoConfig
          // Missing strategy
        })
      ).toThrow('strategy required')
    })
  })
})
