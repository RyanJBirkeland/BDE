import { describe, it, expect, vi } from 'vitest'
import { withRetry, withRetryAsync } from '../sqlite-retry'

describe('withRetry', () => {
  it('returns result on first success', () => {
    const fn = vi.fn().mockReturnValue(42)
    expect(withRetry(fn)).toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on SQLITE_BUSY and succeeds', () => {
    const busyError = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
    const fn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw busyError
      })
      .mockReturnValue(42)
    expect(withRetry(fn)).toBe(42)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws after max retries', () => {
    const busyError = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
    const fn = vi.fn().mockImplementation(() => {
      throw busyError
    })
    expect(() => withRetry(fn, { maxRetries: 3 })).toThrow('database is locked')
    expect(fn).toHaveBeenCalledTimes(4) // initial + 3 retries
  })

  it('does not retry non-BUSY errors', () => {
    const fn = vi.fn().mockImplementation(() => {
      throw new Error('syntax error')
    })
    expect(() => withRetry(fn)).toThrow('syntax error')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on "database is locked" message without SQLITE_BUSY code', () => {
    const busyError = new Error('database is locked')
    const fn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw busyError
      })
      .mockReturnValue(42)
    expect(withRetry(fn)).toBe(42)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('handles functions returning null or undefined', () => {
    const fn = vi.fn().mockReturnValue(null)
    expect(withRetry(fn)).toBe(null)
    expect(fn).toHaveBeenCalledTimes(1)

    const fn2 = vi.fn().mockReturnValue(undefined)
    expect(withRetry(fn2)).toBe(undefined)
    expect(fn2).toHaveBeenCalledTimes(1)
  })
})

describe('withRetryAsync', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockReturnValue(42)
    await expect(withRetryAsync(fn)).resolves.toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on SQLITE_BUSY and succeeds', async () => {
    const busyError = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
    const fn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw busyError
      })
      .mockReturnValue(99)
    await expect(withRetryAsync(fn, { baseDelayMs: 1 })).resolves.toBe(99)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws after max retries', async () => {
    const busyError = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
    const fn = vi.fn().mockImplementation(() => {
      throw busyError
    })
    await expect(withRetryAsync(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow(
      'database is locked'
    )
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-BUSY errors', async () => {
    const fn = vi.fn().mockImplementation(() => {
      throw new Error('syntax error')
    })
    await expect(withRetryAsync(fn)).rejects.toThrow('syntax error')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('supports async functions that return a Promise', async () => {
    const fn = vi.fn().mockResolvedValue('done')
    await expect(withRetryAsync(fn)).resolves.toBe('done')
  })

  it('does not block the event loop while retrying (uses setTimeout)', async () => {
    // This test asserts the event loop spins during backoff. If withRetryAsync
    // ever regresses to Atomics.wait, the eventLoopTick promise would not resolve
    // until after the retry chain completed.
    const busyError = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
    let calls = 0
    const fn = vi.fn().mockImplementation(() => {
      calls++
      if (calls < 3) throw busyError
      return 'ok'
    })

    let eventLoopTicks = 0
    const interval = setInterval(() => {
      eventLoopTicks++
    }, 1)

    try {
      const result = await withRetryAsync(fn, { baseDelayMs: 20 })
      expect(result).toBe('ok')
      // Two backoffs of 20ms + 40ms = ~60ms total. With a 1ms interval the
      // event loop should tick well over 10 times if the loop is free. A
      // regression where backoff collapses to 1ms (or blocks the loop) would
      // produce far fewer ticks. Threshold picked to be robust under CI
      // jitter while still catching real regressions.
      expect(eventLoopTicks).toBeGreaterThan(10)
    } finally {
      clearInterval(interval)
    }
  })
})
