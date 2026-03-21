import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock child_process before imports ---

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

import { execFile } from 'child_process'
import {
  handleAgentCompletion,
  MAX_RETRIES,
  MAX_FAST_FAILS,
  FAST_FAIL_THRESHOLD_MS,
} from '../../agent-manager/completion-handler'
import type { CompletionContext } from '../../agent-manager/completion-handler'

// --- Helpers ---

/** Mock execFile to respond based on command/args patterns. */
function mockExecFileResponses(
  responses: Array<{
    match: (cmd: string, args: string[]) => boolean
    result: { stdout: string; stderr?: string } | Error
  }>,
) {
  vi.mocked(execFile).mockImplementation((...rawArgs: unknown[]) => {
    const cmd = rawArgs[0] as string
    const args = rawArgs[1] as string[]
    const cb = rawArgs[rawArgs.length - 1] as (
      err: Error | null,
      result?: { stdout: string; stderr: string },
    ) => void

    const matched = responses.find((r) => r.match(cmd, args))
    if (matched) {
      if (matched.result instanceof Error) {
        cb(matched.result)
      } else {
        cb(null, { stdout: matched.result.stdout, stderr: matched.result.stderr ?? '' })
      }
    } else {
      cb(null, { stdout: '', stderr: '' })
    }

    return {} as ReturnType<typeof execFile>
  })
}

function makeCtx(overrides: Partial<CompletionContext> = {}): CompletionContext {
  return {
    taskId: 'task-1',
    agentId: 'agent-1',
    repoPath: '/repos/bde',
    worktreePath: '/tmp/worktrees/task-1',
    ghRepo: 'org/bde',
    exitCode: 0,
    worktreeBase: '/tmp/worktrees',
    retryCount: 0,
    fastFailCount: 0,
    durationMs: 45_000,
    updateTask: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('Completion handler integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Success flow ───────────────────────────────────────────────────

  describe('success flow: agent exits 0', () => {
    it('pushes branch, opens PR, marks task done, cleans up worktree', async () => {
      const ctx = makeCtx({ exitCode: 0 })

      mockExecFileResponses([
        // getActualBranch
        {
          match: (cmd, args) => cmd === 'git' && args.includes('rev-parse'),
          result: { stdout: 'agent/task-1\n' },
        },
        // git push
        {
          match: (cmd, args) => cmd === 'git' && args.includes('push'),
          result: { stdout: '' },
        },
        // gh pr create
        {
          match: (cmd) => cmd === 'gh',
          result: { stdout: 'https://github.com/org/bde/pull/42\n' },
        },
        // git worktree remove
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree') && args.includes('remove'),
          result: { stdout: '' },
        },
        // git worktree prune
        {
          match: (cmd, args) => cmd === 'git' && args.includes('prune'),
          result: { stdout: '' },
        },
      ])

      await handleAgentCompletion(ctx)

      // Verify git push was called with correct branch
      expect(execFile).toHaveBeenCalledWith(
        'git',
        ['push', '-u', 'origin', 'agent/task-1'],
        expect.objectContaining({ cwd: '/tmp/worktrees/task-1' }),
        expect.any(Function),
      )

      // Verify gh pr create was called
      expect(execFile).toHaveBeenCalledWith(
        'gh',
        ['pr', 'create', '--repo', 'org/bde', '--head', 'agent/task-1', '--fill'],
        expect.objectContaining({ cwd: '/tmp/worktrees/task-1' }),
        expect.any(Function),
      )

      // Verify task marked done with PR details
      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'done',
        pr_url: 'https://github.com/org/bde/pull/42',
        pr_number: 42,
        pr_status: 'open',
        completed_at: expect.any(String),
      })

      // Verify worktree was cleaned up
      expect(execFile).toHaveBeenCalledWith(
        'git',
        ['worktree', 'remove', '--force', '/tmp/worktrees/task-1'],
        expect.objectContaining({ cwd: '/repos/bde' }),
        expect.any(Function),
      )
    })

    it('marks task done with null PR when gh pr create fails', async () => {
      const ctx = makeCtx({ exitCode: 0 })

      mockExecFileResponses([
        // getActualBranch
        {
          match: (cmd, args) => cmd === 'git' && args.includes('rev-parse'),
          result: { stdout: 'agent/task-1\n' },
        },
        // git push
        {
          match: (cmd, args) => cmd === 'git' && args.includes('push'),
          result: { stdout: '' },
        },
        // gh pr create fails (PR already exists, etc.)
        {
          match: (cmd) => cmd === 'gh',
          result: new Error('GraphQL: Validation Failed'),
        },
        // worktree cleanup
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree'),
          result: { stdout: '' },
        },
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

  // ── Failure flow: retry ────────────────────────────────────────────

  describe('failure flow: agent exits non-zero', () => {
    it('requeues task with incremented retry_count on first failure', async () => {
      const ctx = makeCtx({
        exitCode: 1,
        retryCount: 0,
        durationMs: 60_000, // Not a fast fail
      })

      mockExecFileResponses([
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree'),
          result: { stdout: '' },
        },
      ])

      await handleAgentCompletion(ctx)

      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'queued',
        retry_count: 1,
        fast_fail_count: 0,
        claimed_by: null,
        agent_run_id: null,
      })
    })

    it('marks task as error when max retries exceeded', async () => {
      const ctx = makeCtx({
        exitCode: 1,
        retryCount: MAX_RETRIES - 1, // This will be incremented to MAX_RETRIES
        durationMs: 60_000,
      })

      mockExecFileResponses([
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree'),
          result: { stdout: '' },
        },
      ])

      await handleAgentCompletion(ctx)

      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'error',
        retry_count: MAX_RETRIES,
        fast_fail_count: 0,
      })
    })
  })

  // ── Fast-fail flow ─────────────────────────────────────────────────

  describe('fast-fail flow: agent exits in < 30s', () => {
    it('increments fast_fail_count and requeues on first fast fail', async () => {
      const ctx = makeCtx({
        exitCode: 1,
        retryCount: 0,
        fastFailCount: 0,
        durationMs: 5_000, // Under threshold
      })

      mockExecFileResponses([
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree'),
          result: { stdout: '' },
        },
      ])

      await handleAgentCompletion(ctx)

      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'queued',
        retry_count: 0,
        fast_fail_count: 1,
        claimed_by: null,
        agent_run_id: null,
      })
    })

    it('marks task as error when max fast fails exceeded', async () => {
      const ctx = makeCtx({
        exitCode: 1,
        retryCount: 0,
        fastFailCount: MAX_FAST_FAILS - 1, // Will be incremented to MAX_FAST_FAILS
        durationMs: 5_000,
      })

      mockExecFileResponses([
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree'),
          result: { stdout: '' },
        },
      ])

      await handleAgentCompletion(ctx)

      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'error',
        retry_count: 0,
        fast_fail_count: MAX_FAST_FAILS,
      })
    })

    it('treats exactly FAST_FAIL_THRESHOLD_MS as a normal failure (not fast fail)', async () => {
      const ctx = makeCtx({
        exitCode: 1,
        retryCount: 0,
        fastFailCount: 0,
        durationMs: FAST_FAIL_THRESHOLD_MS, // Exactly at threshold
      })

      mockExecFileResponses([
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree'),
          result: { stdout: '' },
        },
      ])

      await handleAgentCompletion(ctx)

      // Should increment retry_count (not fast_fail_count)
      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'queued',
        retry_count: 1,
        fast_fail_count: 0,
        claimed_by: null,
        agent_run_id: null,
      })
    })
  })

  // ── Worktree cleanup always runs ───────────────────────────────────

  describe('worktree cleanup', () => {
    it('cleans up worktree on success', async () => {
      const ctx = makeCtx({ exitCode: 0 })

      mockExecFileResponses([
        {
          match: (cmd, args) => cmd === 'git' && args.includes('rev-parse'),
          result: { stdout: 'agent/task-1\n' },
        },
        {
          match: (cmd, args) => cmd === 'git' && args.includes('push'),
          result: { stdout: '' },
        },
        {
          match: (cmd) => cmd === 'gh',
          result: { stdout: 'https://github.com/org/bde/pull/1\n' },
        },
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree'),
          result: { stdout: '' },
        },
      ])

      await handleAgentCompletion(ctx)

      expect(execFile).toHaveBeenCalledWith(
        'git',
        ['worktree', 'remove', '--force', '/tmp/worktrees/task-1'],
        expect.any(Object),
        expect.any(Function),
      )
    })

    it('cleans up worktree on failure', async () => {
      const ctx = makeCtx({ exitCode: 1, durationMs: 60_000 })

      mockExecFileResponses([
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree'),
          result: { stdout: '' },
        },
      ])

      await handleAgentCompletion(ctx)

      expect(execFile).toHaveBeenCalledWith(
        'git',
        ['worktree', 'remove', '--force', '/tmp/worktrees/task-1'],
        expect.any(Object),
        expect.any(Function),
      )
    })

    it('does not throw when worktree cleanup fails', async () => {
      const ctx = makeCtx({ exitCode: 1, durationMs: 60_000 })

      mockExecFileResponses([
        // worktree remove fails
        {
          match: (cmd, args) => cmd === 'git' && args.includes('remove'),
          result: new Error('fatal: not a git worktree'),
        },
        // worktree prune (still called via removeWorktree)
        {
          match: (cmd, args) => cmd === 'git' && args.includes('prune'),
          result: { stdout: '' },
        },
      ])

      // Should not throw despite cleanup failure
      await expect(handleAgentCompletion(ctx)).resolves.toBeUndefined()

      // But updateTask should still have been called for the failure handling
      expect(ctx.updateTask).toHaveBeenCalled()
    })

    it('cleans up worktree even when success handler throws', async () => {
      const ctx = makeCtx({ exitCode: 0 })

      mockExecFileResponses([
        // getActualBranch throws
        {
          match: (cmd, args) => cmd === 'git' && args.includes('rev-parse'),
          result: new Error('not a git repository'),
        },
        // worktree cleanup should still happen
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree'),
          result: { stdout: '' },
        },
      ])

      // handleAgentCompletion catches errors via try/finally, so the
      // worktree cleanup still runs. However getActualBranch throws inside
      // handleSuccess, which will propagate out of handleAgentCompletion.
      await expect(handleAgentCompletion(ctx)).rejects.toThrow()

      // Verify worktree remove was still called (in finally block)
      const worktreeRemoveCalls = vi.mocked(execFile).mock.calls.filter(
        (call) => call[0] === 'git' && (call[1] as string[]).includes('remove'),
      )
      expect(worktreeRemoveCalls.length).toBeGreaterThan(0)
    })
  })

  // ── Defaults for optional fields ───────────────────────────────────

  describe('optional field defaults', () => {
    it('uses 0 for retryCount and fastFailCount when undefined', async () => {
      const ctx = makeCtx({
        exitCode: 1,
        retryCount: undefined,
        fastFailCount: undefined,
        durationMs: 60_000,
      })

      mockExecFileResponses([
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree'),
          result: { stdout: '' },
        },
      ])

      await handleAgentCompletion(ctx)

      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'queued',
        retry_count: 1,
        fast_fail_count: 0,
        claimed_by: null,
        agent_run_id: null,
      })
    })

    it('treats undefined durationMs as non-fast-fail', async () => {
      const ctx = makeCtx({
        exitCode: 1,
        retryCount: 0,
        fastFailCount: 0,
        durationMs: undefined,
      })

      mockExecFileResponses([
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree'),
          result: { stdout: '' },
        },
      ])

      await handleAgentCompletion(ctx)

      // Should be a normal retry (not fast fail)
      expect(ctx.updateTask).toHaveBeenCalledWith({
        status: 'queued',
        retry_count: 1,
        fast_fail_count: 0,
        claimed_by: null,
        agent_run_id: null,
      })
    })
  })

  // ── PR number parsing ──────────────────────────────────────────────

  describe('PR URL parsing', () => {
    it('extracts PR number from standard GitHub URL', async () => {
      const ctx = makeCtx({ exitCode: 0 })

      mockExecFileResponses([
        {
          match: (cmd, args) => cmd === 'git' && args.includes('rev-parse'),
          result: { stdout: 'agent/task-1\n' },
        },
        {
          match: (cmd, args) => cmd === 'git' && args.includes('push'),
          result: { stdout: '' },
        },
        {
          match: (cmd) => cmd === 'gh',
          result: { stdout: 'https://github.com/org/bde/pull/123\n' },
        },
        {
          match: (cmd, args) => cmd === 'git' && args.includes('worktree'),
          result: { stdout: '' },
        },
      ])

      await handleAgentCompletion(ctx)

      expect(ctx.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          pr_url: 'https://github.com/org/bde/pull/123',
          pr_number: 123,
        }),
      )
    })
  })
})
