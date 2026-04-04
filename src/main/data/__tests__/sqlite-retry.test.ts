import { describe, it, expect, vi } from 'vitest'
import { withRetry } from '../sqlite-retry'

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
