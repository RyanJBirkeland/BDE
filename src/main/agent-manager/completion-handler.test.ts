import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Hoisted mocks ---
const {
  mockExecFile,
  mockGetActualBranch,
  mockRemoveWorktree,
} = vi.hoisted(() => {
  const customSym = Symbol.for('nodejs.util.promisify.custom')
  const fn = vi.fn()
  ;(fn as unknown as Record<string | symbol, unknown>)[customSym] = (...args: unknown[]) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      fn(...args, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      })
    })
  }
  return {
    mockExecFile: fn,
    mockGetActualBranch: vi.fn(),
    mockRemoveWorktree: vi.fn(),
  }
})

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}))

vi.mock('./worktree-ops', () => ({
  getActualBranch: mockGetActualBranch,
  removeWorktree: mockRemoveWorktree,
}))

import { handleAgentCompletion, CompletionContext } from './completion-handler'

// --- Helpers ---

function execFileSucceedsSequence(results: { stdout?: string; err?: Error }[]): void {
  let callIndex = 0
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (
      err: Error | null,
      stdout: string,
      stderr: string,
    ) => void
    const result = results[callIndex] ?? { stdout: '' }
    callIndex++
    if (typeof cb === 'function') {
      if (result.err) {
        cb(result.err, '', '')
      } else {
        cb(null, result.stdout ?? '', '')
      }
    }
  })
}

function makeCtx(overrides: Partial<CompletionContext> = {}): CompletionContext {
  return {
    taskId: 'task-42',
    agentId: 'agent-1',
    repoPath: '/repo',
    worktreePath: '/tmp/wt/task-42',
    ghRepo: 'owner/repo',
    exitCode: 0,
    worktreeBase: '/tmp/wt',
    retryCount: 0,
    fastFailCount: 0,
    updateTask: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('CompletionHandler', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockRemoveWorktree.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('success path (exitCode 0)', () => {
    it('pushes branch and opens PR on success', async () => {
      const ctx = makeCtx({ exitCode: 0 })
      mockGetActualBranch.mockResolvedValue('agent/task-42')
      execFileSucceedsSequence([
        { stdout: '' }, // git push
        { stdout: 'https://github.com/owner/repo/pull/17\n' }, // gh pr create
      ])

      await handleAgentCompletion(ctx)

      // Verify getActualBranch was called
      expect(mockGetActualBranch).toHaveBeenCalledWith('/tmp/wt/task-42')

      // Verify git push
      const pushCall = mockExecFile.mock.calls[0]
      expect(pushCall[0]).toBe('git')
      expect(pushCall[1]).toEqual(['push', '-u', 'origin', 'agent/task-42'])

      // Verify gh pr create
      const prCall = mockExecFile.mock.calls[1]
      expect(prCall[0]).toBe('gh')
      expect(prCall[1]).toEqual([
        'pr', 'create', '--repo', 'owner/repo', '--head', 'agent/task-42', '--fill',
      ])

      // Verify updateTask called with done status
      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'done',
        pr_url: 'https://github.com/owner/repo/pull/17',
        pr_number: 17,
        pr_status: 'open',
        completed_at: expect.any(String),
      })

      // Verify completed_at is a valid ISO string
      const call = (ctx.updateTask as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(() => new Date(call.completed_at)).not.toThrow()
    })

    it('handles PR creation failure gracefully (returns null URL)', async () => {
      const ctx = makeCtx({ exitCode: 0 })
      mockGetActualBranch.mockResolvedValue('agent/task-42')
      execFileSucceedsSequence([
        { stdout: '' }, // git push
        { err: new Error('gh: failed to create PR') }, // gh pr create fails
      ])

      await handleAgentCompletion(ctx)

      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'done',
        pr_url: null,
        pr_number: null,
        pr_status: 'open',
        completed_at: expect.any(String),
      })
    })
  })

  describe('failure path (exitCode !== 0)', () => {
    it('requeues task on failure when under max retries', async () => {
      const ctx = makeCtx({ exitCode: 1, retryCount: 0, durationMs: 60_000 })

      await handleAgentCompletion(ctx)

      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'queued',
        retry_count: 1,
        fast_fail_count: 0,
        claimed_by: null,
        agent_run_id: null,
      })
    })

    it('sets error status when max retries exceeded', async () => {
      const ctx = makeCtx({ exitCode: 1, retryCount: 2, durationMs: 60_000 })

      await handleAgentCompletion(ctx)

      expect(ctx.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          retry_count: 3,
        }),
      )
    })

    it('detects fast-fail (under 30s) and does not burn retry', async () => {
      const ctx = makeCtx({
        exitCode: 1,
        retryCount: 0,
        fastFailCount: 0,
        durationMs: 5_000,
      })

      await handleAgentCompletion(ctx)

      // Fast-fail should increment fastFailCount, NOT retryCount
      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'queued',
        retry_count: 0,
        fast_fail_count: 1,
        claimed_by: null,
        agent_run_id: null,
      })
    })

    it('sets error after 3 consecutive fast-fails', async () => {
      const ctx = makeCtx({
        exitCode: 1,
        retryCount: 0,
        fastFailCount: 2,
        durationMs: 5_000,
      })

      await handleAgentCompletion(ctx)

      expect(ctx.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          fast_fail_count: 3,
        }),
      )
    })

    it('treats missing durationMs as non-fast-fail', async () => {
      const ctx = makeCtx({
        exitCode: 1,
        retryCount: 1,
        fastFailCount: 0,
        durationMs: undefined,
      })

      await handleAgentCompletion(ctx)

      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'queued',
        retry_count: 2,
        fast_fail_count: 0,
        claimed_by: null,
        agent_run_id: null,
      })
    })
  })

  describe('worktree cleanup', () => {
    it('always cleans up worktree on success', async () => {
      const ctx = makeCtx({ exitCode: 0 })
      mockGetActualBranch.mockResolvedValue('agent/task-42')
      execFileSucceedsSequence([
        { stdout: '' },
        { stdout: 'https://github.com/owner/repo/pull/1\n' },
      ])

      await handleAgentCompletion(ctx)

      expect(mockRemoveWorktree).toHaveBeenCalledWith('/repo', '/tmp/wt/task-42')
    })

    it('always cleans up worktree on failure', async () => {
      const ctx = makeCtx({ exitCode: 1, durationMs: 60_000 })

      await handleAgentCompletion(ctx)

      expect(mockRemoveWorktree).toHaveBeenCalledWith('/repo', '/tmp/wt/task-42')
    })

    it('does not rethrow if worktree cleanup fails', async () => {
      const ctx = makeCtx({ exitCode: 1, durationMs: 60_000, retryCount: 0 })
      mockRemoveWorktree.mockRejectedValue(new Error('cleanup failed'))

      // Should not throw even though removeWorktree fails
      await expect(handleAgentCompletion(ctx)).resolves.toBeUndefined()

      expect(ctx.updateTask).toHaveBeenCalled()
    })

    it('cleans up worktree even when updateTask throws', async () => {
      const ctx = makeCtx({ exitCode: 0 })
      mockGetActualBranch.mockResolvedValue('agent/task-42')
      execFileSucceedsSequence([
        { stdout: '' },
        { stdout: 'https://github.com/owner/repo/pull/1\n' },
      ])
      ;(ctx.updateTask as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('db error'),
      )

      // Should throw the updateTask error but still clean up
      await expect(handleAgentCompletion(ctx)).rejects.toThrow('db error')

      expect(mockRemoveWorktree).toHaveBeenCalledWith('/repo', '/tmp/wt/task-42')
    })
  })
})
