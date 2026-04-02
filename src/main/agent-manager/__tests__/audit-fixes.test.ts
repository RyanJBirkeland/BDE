/**
 * Tests for critical/high security audit fixes (AM-1 through AM-6)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sanitizeForGit, resolveFailure } from '../completion'
import { handleWatchdogVerdict } from '../index'
import { makeConcurrencyState } from '../concurrency'
import type { ISprintTaskRepository } from '../../data/sprint-task-repository'
import { MAX_RETRIES } from '../types'

// ---------------------------------------------------------------------------
// AM-3: sanitizeForGit tests
// ---------------------------------------------------------------------------

describe('sanitizeForGit (AM-3)', () => {
  it('replaces backticks with single quotes', () => {
    expect(sanitizeForGit('Add `foo` method')).toBe("Add 'foo' method")
    expect(sanitizeForGit('Fix `bar` and `baz`')).toBe("Fix 'bar' and 'baz'")
  })

  it('escapes command substitution patterns', () => {
    expect(sanitizeForGit('Run $(whoami)')).toBe('Run $(whoami)')
    expect(sanitizeForGit('Execute $(rm -rf /)')).toBe('Execute $(rm -rf /)')
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
    expect(sanitizeForGit(malicious)).toBe("Run '$(rm -rf /)' see details")
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
  let updateTaskFn: ReturnType<typeof vi.fn>
  let onTerminal: ReturnType<typeof vi.fn>
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  beforeEach(() => {
    updateTaskFn = vi.fn()
    onTerminal = vi.fn().mockResolvedValue(undefined)
    logger.info.mockClear()
    logger.warn.mockClear()
    logger.error.mockClear()
  })

  it('clears claimed_by on max-runtime kill', () => {
    const concurrency = makeConcurrencyState(2)
    const now = new Date().toISOString()

    handleWatchdogVerdict(
      'max-runtime',
      'task-123',
      concurrency,
      now,
      updateTaskFn,
      onTerminal,
      logger,
      3600000
    )

    expect(updateTaskFn).toHaveBeenCalledWith(
      'task-123',
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
    const now = new Date().toISOString()

    handleWatchdogVerdict(
      'idle',
      'task-456',
      concurrency,
      now,
      updateTaskFn,
      onTerminal,
      logger
    )

    expect(updateTaskFn).toHaveBeenCalledWith(
      'task-456',
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
    const now = new Date().toISOString()

    handleWatchdogVerdict(
      'rate-limit-loop',
      'task-789',
      concurrency,
      now,
      updateTaskFn,
      onTerminal,
      logger
    )

    expect(updateTaskFn).toHaveBeenCalledWith(
      'task-789',
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
  let mockRepo: ISprintTaskRepository

  beforeEach(() => {
    mockRepo = {
      updateTask: vi.fn(),
      getTask: vi.fn(),
      getQueuedTasks: vi.fn(),
      getTasksWithDependencies: vi.fn().mockReturnValue([]),
      getOrphanedTasks: vi.fn(),
      getActiveTaskCount: vi.fn().mockReturnValue(0),
      claimTask: vi.fn()
    }
    logger.error.mockClear()
  })

  it('returns false when retries not exhausted (DB success)', () => {
    const result = resolveFailure(
      { taskId: 'task-1', retryCount: 0, repo: mockRepo },
      logger
    )

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

    const result = resolveFailure(
      { taskId: 'task-3', retryCount: 1, repo: mockRepo },
      logger
    )

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
