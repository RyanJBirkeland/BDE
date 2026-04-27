import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskTransitionError, cancelTask } from '../sprint-service'

vi.mock('../../lib/async-utils', () => ({
  sleep: vi.fn().mockResolvedValue(undefined)
}))

// sprint-mutations is the factory-injected layer (T-133). Stub it so
// cancelTask's getTask() fallback in the error path does not throw.
vi.mock('../sprint-mutations', () => ({
  getTask: vi.fn().mockReturnValue(null),
  updateTask: vi.fn(),
  forceUpdateTask: vi.fn(),
  listTasks: vi.fn(),
  listTasksRecent: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  claimTask: vi.fn(),
  releaseTask: vi.fn(),
  getQueueStats: vi.fn(),
  getDoneTodayCount: vi.fn(),
  listTasksWithOpenPrs: vi.fn(),
  getHealthCheckTasks: vi.fn(),
  getSuccessRateBySpecType: vi.fn(),
  getDailySuccessRate: vi.fn(),
  markTaskDoneByPrNumber: vi.fn(),
  markTaskCancelledByPrNumber: vi.fn(),
  updateTaskMergeableState: vi.fn(),
  flagStuckTasks: vi.fn(),
  createReviewTaskFromAdhoc: vi.fn(),
  createSprintMutations: vi.fn()
}))

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}

const cancelledRow = { id: 't1', status: 'cancelled', notes: null }

describe('cancelTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---- 6.1 onStatusTerminal succeeds → clean result ----------------------------

  it('sets status to cancelled and returns { row, sideEffectFailed: false } on clean success', async () => {
    const updateTask = vi.fn().mockReturnValue(cancelledRow)
    const onStatusTerminal = vi.fn().mockResolvedValue(undefined)

    const result = await cancelTask(
      't1',
      { reason: 'no longer needed' },
      { onStatusTerminal, logger: fakeLogger, updateTask }
    )

    expect(updateTask).toHaveBeenCalledWith(
      't1',
      { status: 'cancelled', notes: 'no longer needed' },
      undefined
    )
    expect(onStatusTerminal).toHaveBeenCalledWith('t1', 'cancelled')
    expect(result).toEqual({ row: cancelledRow, sideEffectFailed: false })
  })

  it('omits notes when no reason is provided', async () => {
    const updateTask = vi.fn().mockReturnValue(cancelledRow)
    const onStatusTerminal = vi.fn().mockResolvedValue(undefined)

    await cancelTask('t1', {}, { onStatusTerminal, logger: fakeLogger, updateTask })

    expect(updateTask).toHaveBeenCalledWith('t1', { status: 'cancelled' }, undefined)
  })

  it('forwards the caller attribution through updateTask', async () => {
    const updateTask = vi.fn().mockReturnValue(cancelledRow)
    const onStatusTerminal = vi.fn().mockResolvedValue(undefined)

    await cancelTask(
      't1',
      { reason: 'no longer needed', caller: 'mcp' },
      { onStatusTerminal, logger: fakeLogger, updateTask }
    )

    expect(updateTask).toHaveBeenCalledWith(
      't1',
      { status: 'cancelled', notes: 'no longer needed' },
      { caller: 'mcp' }
    )
  })

  // ---- 6.4 task not found → { row: null } ------------------------------------

  it('returns { row: null } and skips onStatusTerminal when updateTask misses', async () => {
    const updateTask = vi.fn().mockReturnValue(null)
    const onStatusTerminal = vi.fn()

    const result = await cancelTask(
      'missing',
      {},
      { onStatusTerminal, logger: fakeLogger, updateTask }
    )

    expect(result).toEqual({ row: null })
    expect(onStatusTerminal).not.toHaveBeenCalled()
  })

  // ---- 6.2 onStatusTerminal fails once, succeeds on retry --------------------

  it('returns { row, sideEffectFailed: false } when onStatusTerminal succeeds on retry', async () => {
    const updateTask = vi.fn().mockReturnValue(cancelledRow)
    const onStatusTerminal = vi.fn()
      .mockRejectedValueOnce(new Error('dep-index offline'))
      .mockResolvedValueOnce(undefined)

    const result = await cancelTask(
      't1',
      {},
      { onStatusTerminal, logger: fakeLogger, updateTask }
    )

    expect(onStatusTerminal).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ row: cancelledRow, sideEffectFailed: false })
  })

  // ---- 6.3 onStatusTerminal fails on both attempts → degraded result + annotation

  it('returns { row, sideEffectFailed: true, sideEffectError } when onStatusTerminal fails both attempts', async () => {
    const dispatchError = new Error('dep-index offline')
    const updateTask = vi.fn().mockReturnValue(cancelledRow)
    const onStatusTerminal = vi.fn().mockRejectedValue(dispatchError)

    const result = await cancelTask(
      't1',
      {},
      { onStatusTerminal, logger: fakeLogger, updateTask }
    )

    expect(onStatusTerminal).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      row: cancelledRow,
      sideEffectFailed: true,
      sideEffectError: dispatchError
    })
  })

  it('writes notes annotation containing "terminal-dispatch-failed" when onStatusTerminal fails persistently', async () => {
    const updateTask = vi.fn().mockReturnValue(cancelledRow)
    const onStatusTerminal = vi.fn().mockRejectedValue(new Error('boom'))

    await cancelTask('t1', {}, { onStatusTerminal, logger: fakeLogger, updateTask })

    const annotationCall = updateTask.mock.calls.find(
      ([_id, patch]) => typeof patch.notes === 'string' && patch.notes.includes('terminal-dispatch-failed')
    )
    expect(annotationCall).toBeDefined()
  })

  // ---- 6.5 Existing notes are preserved (annotation is appended) -------------

  it('appends annotation to existing notes instead of replacing them', async () => {
    const rowWithNotes = { ...cancelledRow, notes: 'existing context' }
    const updateTask = vi.fn().mockReturnValue(rowWithNotes)
    const onStatusTerminal = vi.fn().mockRejectedValue(new Error('boom'))

    await cancelTask('t1', {}, { onStatusTerminal, logger: fakeLogger, updateTask })

    const annotationCall = updateTask.mock.calls.find(
      ([_id, patch]) => typeof patch.notes === 'string' && patch.notes.includes('terminal-dispatch-failed')
    )
    expect(annotationCall).toBeDefined()
    const [, patch] = annotationCall!
    expect(patch.notes).toContain('existing context')
    expect(patch.notes).toContain('terminal-dispatch-failed')
  })

  it('translates data-layer invalid-transition throws into TaskTransitionError', async () => {
    const updateTask = vi.fn(() => {
      throw new Error(
        '[sprint-queries] Invalid transition for task t1: Invalid transition: done → cancelled. Allowed: cancelled'
      )
    })
    const onStatusTerminal = vi.fn()

    await expect(
      cancelTask('t1', {}, { onStatusTerminal, logger: fakeLogger, updateTask })
    ).rejects.toBeInstanceOf(TaskTransitionError)

    expect(onStatusTerminal).not.toHaveBeenCalled()
  })

  it('leaves unknown update errors unchanged', async () => {
    const boom = new Error('disk full')
    const updateTask = vi.fn(() => {
      throw boom
    })
    const onStatusTerminal = vi.fn()

    await expect(
      cancelTask('t1', {}, { onStatusTerminal, logger: fakeLogger, updateTask })
    ).rejects.toBe(boom)
  })
})
