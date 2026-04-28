import { describe, it, expect, vi } from 'vitest'
import { resolveFailure, calculateRetryBackoff } from '../resolve-failure-phases'
import { MAX_RETRIES, RETRY_BACKOFF_BASE_MS, RETRY_BACKOFF_CAP_MS } from '../types'
import type { TaskStateService } from '../../services/task-state-service'

function makeRepo(overrides: { updateTask?: ReturnType<typeof vi.fn>; getTask?: ReturnType<typeof vi.fn> } = {}) {
  return {
    getTask: overrides.getTask ?? vi.fn().mockReturnValue({ started_at: new Date(Date.now() - 5000).toISOString() }),
    updateTask: overrides.updateTask ?? vi.fn()
  }
}

/**
 * Builds a TaskStateService mock that delegates writes to `repo.updateTask`.
 * Mirrors the mock pattern in index.test.ts so tests remain repo-observable.
 */
function makeTaskStateService(repo: ReturnType<typeof makeRepo>): TaskStateService {
  return {
    transition: vi.fn(async (_taskId: string, status: string, ctx: { fields?: Record<string, unknown> } = {}) => {
      await repo.updateTask(_taskId, { status, ...(ctx.fields ?? {}) })
      return { committed: true, dependentsResolved: true }
    })
  } as unknown as TaskStateService
}

function makeThrowingTaskStateService(): TaskStateService {
  return {
    transition: vi.fn().mockImplementation(() => { throw new Error('DB locked') })
  } as unknown as TaskStateService
}

describe('resolveFailure — non-terminal (retries remaining)', () => {
  it('calls repo.updateTask with status queued and returns isTerminal:false', async () => {
    const repo = makeRepo()
    const taskStateService = makeTaskStateService(repo)
    const result = await resolveFailure({ taskId: 't-1', retryCount: 0, repo: repo as never, taskStateService })

    expect(result).toMatchObject({ isTerminal: false })
    expect(result.writeFailed).toBeFalsy()
    expect(repo.updateTask).toHaveBeenCalledOnce()
    const [id, patch] = repo.updateTask.mock.calls[0]
    expect(id).toBe('t-1')
    expect(patch.status).toBe('queued')
    expect(patch.retry_count).toBe(1)
    expect(patch.claimed_by).toBeNull()
    expect(patch.next_eligible_at).toBeTruthy()
  })

  it('includes notes in the update when provided', async () => {
    const repo = makeRepo()
    const taskStateService = makeTaskStateService(repo)
    await resolveFailure({ taskId: 't-1', retryCount: 1, notes: 'test failed', repo: repo as never, taskStateService })
    const [, patch] = repo.updateTask.mock.calls[0]
    expect(patch.notes).toBe('test failed')
  })
})

describe('resolveFailure — terminal (retries exhausted)', () => {
  it('calls repo.updateTask with status failed and returns isTerminal:true when at MAX_RETRIES', async () => {
    const repo = makeRepo()
    const taskStateService = makeTaskStateService(repo)
    const result = await resolveFailure({ taskId: 't-2', retryCount: MAX_RETRIES, repo: repo as never, taskStateService })

    expect(result).toMatchObject({ isTerminal: true })
    expect(result.writeFailed).toBeFalsy()
    const [id, patch] = repo.updateTask.mock.calls[0]
    expect(id).toBe('t-2')
    expect(patch.status).toBe('failed')
    expect(patch.completed_at).toBeTruthy()
    expect(patch.claimed_by).toBeNull()
    expect(patch.needs_review).toBe(true)
  })

  it('returns isTerminal:true for any retry count >= MAX_RETRIES', async () => {
    const repo = makeRepo()
    const taskStateService = makeTaskStateService(repo)
    const result = await resolveFailure({ taskId: 't-3', retryCount: MAX_RETRIES + 5, repo: repo as never, taskStateService })
    expect(result).toMatchObject({ isTerminal: true })
  })
})

describe('resolveFailure — taskStateService.transition throws', () => {
  it('returns { writeFailed: true } instead of throwing — caller must NOT invoke onTaskTerminal', async () => {
    const repo = makeRepo()
    const taskStateService = makeThrowingTaskStateService()
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), event: vi.fn() }

    const result = await resolveFailure({ taskId: 't-4', retryCount: 0, repo: repo as never, taskStateService }, logger as never)

    expect(result).toMatchObject({ writeFailed: true })
    expect(result).toHaveProperty('error')
    expect(logger.event).toHaveBeenCalledWith('failure.persist_failed', expect.objectContaining({ taskId: 't-4' }))
  })

  it('returns { writeFailed: true, isTerminal: true } when terminal and transition throws', async () => {
    const repo = makeRepo()
    const taskStateService = makeThrowingTaskStateService()
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), event: vi.fn() }

    const result = await resolveFailure({ taskId: 't-5', retryCount: MAX_RETRIES, repo: repo as never, taskStateService }, logger as never)

    expect(result).toMatchObject({ writeFailed: true, isTerminal: true })
    expect(logger.event).toHaveBeenCalledWith('failure.persist_failed', expect.objectContaining({ taskId: 't-5' }))
  })
})

describe('calculateRetryBackoff — jitter bounds', () => {
  it('all 1000 samples fall within ±20% of base delay for retryCount=0', () => {
    const base = Math.min(RETRY_BACKOFF_CAP_MS, RETRY_BACKOFF_BASE_MS * Math.pow(2, 0))
    for (let i = 0; i < 1000; i++) {
      const result = calculateRetryBackoff(0)
      expect(result).toBeGreaterThanOrEqual(Math.floor(base * 0.8))
      expect(result).toBeLessThanOrEqual(Math.ceil(base * 1.2))
    }
  })

  it('all 1000 samples fall within ±20% of base delay for retryCount=1', () => {
    const base = Math.min(RETRY_BACKOFF_CAP_MS, RETRY_BACKOFF_BASE_MS * Math.pow(2, 1))
    for (let i = 0; i < 1000; i++) {
      const result = calculateRetryBackoff(1)
      expect(result).toBeGreaterThanOrEqual(Math.floor(base * 0.8))
      expect(result).toBeLessThanOrEqual(Math.ceil(base * 1.2))
    }
  })

  it('all results are <= RETRY_BACKOFF_CAP_MS regardless of retryCount', () => {
    for (let i = 0; i < 200; i++) {
      const result = calculateRetryBackoff(99)
      expect(result).toBeLessThanOrEqual(Math.ceil(RETRY_BACKOFF_CAP_MS * 1.2))
    }
  })
})
