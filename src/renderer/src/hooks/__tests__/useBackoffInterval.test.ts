import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useBackoffInterval } from '../useBackoffInterval'

describe('useBackoffInterval', () => {
  const BASE_MS = 1000

  beforeEach(() => {
    vi.useFakeTimers()
    // Eliminate randomness: Math.random() => 0, so jitter is always 0
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('calls callback on initial tick', async () => {
    const cb = vi.fn()
    renderHook(() => useBackoffInterval(cb, BASE_MS))

    // With jitter=0, initial setTimeout is 0ms — advance just past it
    await vi.advanceTimersByTimeAsync(1)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('repeats at ~baseMs intervals on success', async () => {
    const cb = vi.fn()
    renderHook(() => useBackoffInterval(cb, BASE_MS))

    // Initial tick
    await vi.advanceTimersByTimeAsync(1)
    expect(cb).toHaveBeenCalledTimes(1)

    // After baseMs, should fire again
    await vi.advanceTimersByTimeAsync(BASE_MS)
    expect(cb).toHaveBeenCalledTimes(2)

    // And again
    await vi.advanceTimersByTimeAsync(BASE_MS)
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it('backs off on error', async () => {
    const cb = vi.fn().mockRejectedValue(new Error('fail'))
    renderHook(() => useBackoffInterval(cb, BASE_MS))

    // Initial tick fires and errors
    await vi.advanceTimersByTimeAsync(1)
    expect(cb).toHaveBeenCalledTimes(1)

    // After baseMs (original interval), should NOT have fired yet because
    // backoff doubles the interval to 2000ms
    await vi.advanceTimersByTimeAsync(BASE_MS)
    expect(cb).toHaveBeenCalledTimes(1)

    // After another baseMs (total 2*baseMs from last tick), fires with backoff
    await vi.advanceTimersByTimeAsync(BASE_MS)
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('resets interval after recovery from error', async () => {
    const cb = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue(undefined)

    renderHook(() => useBackoffInterval(cb, BASE_MS))

    // Initial tick — errors, backoff to 2000ms
    await vi.advanceTimersByTimeAsync(1)
    expect(cb).toHaveBeenCalledTimes(1)

    // Wait for backed-off interval (2000ms)
    await vi.advanceTimersByTimeAsync(2 * BASE_MS)
    expect(cb).toHaveBeenCalledTimes(2)

    // Now succeeds — interval should reset to baseMs
    await vi.advanceTimersByTimeAsync(BASE_MS)
    expect(cb).toHaveBeenCalledTimes(3)
  })

  it('cleans up on unmount', async () => {
    const cb = vi.fn()
    const { unmount } = renderHook(() => useBackoffInterval(cb, BASE_MS))

    // Initial tick
    await vi.advanceTimersByTimeAsync(1)
    expect(cb).toHaveBeenCalledTimes(1)

    unmount()

    // Advance well past several intervals — should not fire again
    await vi.advanceTimersByTimeAsync(BASE_MS * 10)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('respects maxMs cap on backoff', async () => {
    const cb = vi.fn().mockRejectedValue(new Error('fail'))
    renderHook(() => useBackoffInterval(cb, BASE_MS, { maxMs: 3000 }))

    // Initial tick — error, backoff to 2000
    await vi.advanceTimersByTimeAsync(1)
    expect(cb).toHaveBeenCalledTimes(1)

    // Wait 2000ms for second tick — error, backoff would be 4000 but capped to 3000
    await vi.advanceTimersByTimeAsync(2 * BASE_MS)
    expect(cb).toHaveBeenCalledTimes(2)

    // Should fire at 3000ms (capped), not 4000ms
    await vi.advanceTimersByTimeAsync(3 * BASE_MS)
    expect(cb).toHaveBeenCalledTimes(3)
  })
})
