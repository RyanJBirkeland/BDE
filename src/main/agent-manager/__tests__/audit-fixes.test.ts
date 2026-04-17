/**
 * Tests for critical/high security audit fixes (AM-1 through AM-6, plus lifecycle fixes)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveFailure } from '../completion'
import { sanitizeForGit } from '../pr-operations'
import { handleWatchdogVerdict } from '../watchdog-handler'
import { makeConcurrencyState } from '../concurrency'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import { MAX_RETRIES } from '../types'
import { nowIso } from '../../../shared/time'
import { tryEmitPlaygroundEvent } from '../playground-handler'

// ---------------------------------------------------------------------------
// Mocks for tryEmitPlaygroundEvent tests
// ---------------------------------------------------------------------------

vi.mock('../../broadcast', () => ({
  broadcast: vi.fn(),
  broadcastCoalesced: vi.fn()
}))

vi.mock('../../agent-event-mapper', () => ({
  emitAgentEvent: vi.fn(),
  flushAgentEventBatcher: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  // realpath resolves symlinks; default mock returns the path unchanged (no symlinks in tests)
  realpath: vi.fn().mockImplementation((p: string) => Promise.resolve(p))
}))

vi.mock('../../playground-sanitize', () => ({
  sanitizePlaygroundHtml: vi.fn((html: string) => html)
}))

// ---------------------------------------------------------------------------
// AM-3: sanitizeForGit tests
// ---------------------------------------------------------------------------

describe('sanitizeForGit (AM-3)', () => {
  it('replaces backticks with single quotes', () => {
    expect(sanitizeForGit('Add `foo` method')).toBe("Add 'foo' method")
    expect(sanitizeForGit('Fix `bar` and `baz`')).toBe("Fix 'bar' and 'baz'")
  })

  it('neutralizes command substitution patterns', () => {
    expect(sanitizeForGit('Run $(whoami)')).toBe('Run (whoami)')
    expect(sanitizeForGit('Execute $(rm -rf /)')).toBe('Execute (rm -rf /)')
  })

  it('strips markdown links and keeps text only', () => {
    expect(sanitizeForGit('See [docs](https://example.com)')).toBe('See docs')
    expect(sanitizeForGit('Check [API](http://api.example.com/v1)')).toBe('Check API')
    expect(sanitizeForGit('[Link](url) and [Another](url2)')).toBe('Link and Another')
  })

  it('trims whitespace', () => {
    expect(sanitizeForGit('  spaced out  ')).toBe('spaced out')
    expect(sanitizeForGit('\n\ttabbed\t\n')).toBe('tabbed')
  })

  it('handles combined threats', () => {
    const malicious = 'Run `$(rm -rf /)` see [details](http://evil.com)'
    expect(sanitizeForGit(malicious)).toBe("Run '(rm -rf /)' see details")
  })

  it('preserves safe text', () => {
    expect(sanitizeForGit('Add login page')).toBe('Add login page')
    expect(sanitizeForGit('Fix: Update user profile API')).toBe('Fix: Update user profile API')
  })
})

// ---------------------------------------------------------------------------
// AM-4: claimed_by cleared on watchdog kills
// ---------------------------------------------------------------------------

describe('handleWatchdogVerdict claimed_by clearing (AM-4)', () => {
  it('clears claimed_by on max-runtime kill', () => {
    const concurrency = makeConcurrencyState(2)
    const now = nowIso()

    const result = handleWatchdogVerdict('max-runtime', concurrency, now, 3600000)

    expect(result.taskUpdate).toEqual(
      expect.objectContaining({
        status: 'error',
        completed_at: now,
        claimed_by: null,
        needs_review: true
      })
    )
  })

  it('clears claimed_by on idle kill', () => {
    const concurrency = makeConcurrencyState(2)
    const now = nowIso()

    const result = handleWatchdogVerdict('idle', concurrency, now)

    expect(result.taskUpdate).toEqual(
      expect.objectContaining({
        status: 'error',
        completed_at: now,
        claimed_by: null,
        needs_review: true
      })
    )
  })

  it('clears claimed_by on rate-limit-loop requeue', () => {
    const concurrency = makeConcurrencyState(2)
    const now = nowIso()

    const result = handleWatchdogVerdict('rate-limit-loop', concurrency, now)

    expect(result.taskUpdate).toEqual(
      expect.objectContaining({
        status: 'queued',
        claimed_by: null
      })
    )
  })
})

// ---------------------------------------------------------------------------
// AM-5: resolveFailure returns correct terminal status on DB error
// ---------------------------------------------------------------------------

describe('resolveFailure terminal status on DB error (AM-5)', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  let mockRepo: IAgentTaskRepository

  beforeEach(() => {
    mockRepo = {
      updateTask: vi.fn(),
      getTask: vi.fn(),
      getQueuedTasks: vi.fn(),
      getTasksWithDependencies: vi.fn().mockReturnValue([]),
      getOrphanedTasks: vi.fn(),
      clearStaleClaimedBy: vi.fn().mockReturnValue(0),
      getActiveTaskCount: vi.fn().mockReturnValue(0),
      claimTask: vi.fn(),
      getGroup: vi.fn().mockReturnValue(null),
      getGroupTasks: vi.fn().mockReturnValue([]),
      getGroupsWithDependencies: vi.fn().mockReturnValue([])
    }
    logger.error.mockClear()
  })

  it('returns false when retries not exhausted (DB success)', () => {
    const result = resolveFailure({ taskId: 'task-1', retryCount: 0, repo: mockRepo }, logger)

    expect(result).toBe(false)
    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'queued',
        retry_count: 1,
        claimed_by: null
      })
    )
  })

  it('returns true when retries exhausted (DB success)', () => {
    const result = resolveFailure(
      { taskId: 'task-2', retryCount: MAX_RETRIES, repo: mockRepo },
      logger
    )

    expect(result).toBe(true)
    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-2',
      expect.objectContaining({
        status: 'failed',
        claimed_by: null,
        needs_review: true
      })
    )
  })

  it('returns false when retries not exhausted (DB error)', () => {
    vi.mocked(mockRepo.updateTask).mockImplementation(() => {
      throw new Error('DB connection lost')
    })

    const result = resolveFailure({ taskId: 'task-3', retryCount: 1, repo: mockRepo }, logger)

    expect(result).toBe(false)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update task task-3')
    )
  })

  it('returns true when retries exhausted (DB error) - CRITICAL FIX', () => {
    vi.mocked(mockRepo.updateTask).mockImplementation(() => {
      throw new Error('DB connection lost')
    })

    const result = resolveFailure(
      { taskId: 'task-4', retryCount: MAX_RETRIES, repo: mockRepo },
      logger
    )

    // This is the fix: even though DB update failed, we return true
    // so the caller knows to trigger onStatusTerminal callback
    expect(result).toBe(true)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update task task-4')
    )
  })

  it('includes notes when provided', () => {
    resolveFailure(
      {
        taskId: 'task-5',
        retryCount: 0,
        notes: 'Agent produced no commits',
        repo: mockRepo
      },
      logger
    )

    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-5',
      expect.objectContaining({
        notes: 'Agent produced no commits'
      })
    )
  })
})

// ---------------------------------------------------------------------------
// Fix 4: Playground path trailing slash — sibling directory traversal blocked
// ---------------------------------------------------------------------------

describe('tryEmitPlaygroundEvent — path containment (Fix 4: trailing slash)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('blocks a sibling directory that shares a path prefix (trailing slash fix)', async () => {
    const { emitAgentEvent } = await import('../../agent-event-mapper')
    const { stat } = await import('node:fs/promises')
    vi.mocked(stat).mockResolvedValue({ size: 100 } as any)

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

    // /worktrees/abc123-evil passes startsWith('/worktrees/abc123') WITHOUT trailing slash fix
    // It must be blocked because it is NOT inside /worktrees/abc123
    await tryEmitPlaygroundEvent(
      'task-1',
      '/worktrees/abc123-evil/attack.html',
      '/worktrees/abc123',
      logger
    )

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Path traversal blocked'))
    expect(emitAgentEvent).not.toHaveBeenCalled()
  })

  it('allows a file directly inside the worktree root', async () => {
    const { emitAgentEvent } = await import('../../agent-event-mapper')
    const { stat, readFile } = await import('node:fs/promises')
    vi.mocked(stat).mockResolvedValue({ size: 100 } as any)
    vi.mocked(readFile).mockResolvedValue('<html/>' as any)

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

    await tryEmitPlaygroundEvent(
      'task-1',
      '/worktrees/abc123/output.html',
      '/worktrees/abc123',
      logger
    )

    expect(emitAgentEvent).toHaveBeenCalled()
  })

  it('allows a file in a subdirectory inside the worktree', async () => {
    const { emitAgentEvent } = await import('../../agent-event-mapper')
    const { stat, readFile } = await import('node:fs/promises')
    vi.mocked(stat).mockResolvedValue({ size: 100 } as any)
    vi.mocked(readFile).mockResolvedValue('<html/>' as any)

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

    await tryEmitPlaygroundEvent(
      'task-1',
      '/worktrees/abc123/dist/index.html',
      '/worktrees/abc123',
      logger
    )

    expect(emitAgentEvent).toHaveBeenCalled()
  })
})
