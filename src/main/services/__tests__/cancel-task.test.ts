import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskTransitionError, cancelTask } from '../sprint-service'

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}

describe('cancelTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets status to cancelled and awaits onStatusTerminal', async () => {
    const row = { id: 't1', status: 'cancelled' }
    const updateTask = vi.fn().mockReturnValue(row)
    const onStatusTerminal = vi.fn().mockResolvedValue(undefined)

    const result = await cancelTask(
      't1',
      { reason: 'no longer needed' },
      { onStatusTerminal, logger: fakeLogger, updateTask }
    )

    expect(updateTask).toHaveBeenCalledWith('t1', {
      status: 'cancelled',
      notes: 'no longer needed'
    })
    expect(onStatusTerminal).toHaveBeenCalledWith('t1', 'cancelled')
    expect(result).toBe(row)
  })

  it('omits notes when no reason is provided', async () => {
    const updateTask = vi.fn().mockReturnValue({ id: 't1', status: 'cancelled' })
    const onStatusTerminal = vi.fn().mockResolvedValue(undefined)

    await cancelTask('t1', {}, { onStatusTerminal, logger: fakeLogger, updateTask })

    expect(updateTask).toHaveBeenCalledWith('t1', { status: 'cancelled' })
  })

  it('returns null and skips onStatusTerminal when updateTask misses', async () => {
    const updateTask = vi.fn().mockReturnValue(null)
    const onStatusTerminal = vi.fn()

    const result = await cancelTask('missing', {}, {
      onStatusTerminal,
      logger: fakeLogger,
      updateTask
    })

    expect(result).toBeNull()
    expect(onStatusTerminal).not.toHaveBeenCalled()
  })

  it('logs but does not throw when onStatusTerminal rejects', async () => {
    const updateTask = vi.fn().mockReturnValue({ id: 't1', status: 'cancelled' })
    const onStatusTerminal = vi.fn().mockRejectedValue(new Error('dep-index offline'))

    const result = await cancelTask('t1', {}, {
      onStatusTerminal,
      logger: fakeLogger,
      updateTask
    })

    expect(result).toEqual({ id: 't1', status: 'cancelled' })
    expect(fakeLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('onStatusTerminal after cancel t1')
    )
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
