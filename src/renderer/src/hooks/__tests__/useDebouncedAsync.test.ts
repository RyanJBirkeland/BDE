import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useDebouncedAsync } from '../useDebouncedAsync'

describe('useDebouncedAsync', () => {
  const DELAY_MS = 1000

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('calls callback after delay', async () => {
    const cb = vi.fn()
    renderHook(() => useDebouncedAsync(cb, ['value'], { delayMs: DELAY_MS }))

    // Should not call immediately
    expect(cb).not.toHaveBeenCalled()

    // After delay, should call
    await vi.advanceTimersByTimeAsync(DELAY_MS)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('calls onStart immediately when dependencies change', () => {
    const cb = vi.fn()
    const onStart = vi.fn()
    renderHook(() => useDebouncedAsync(cb, ['value'], { delayMs: DELAY_MS, onStart }))

    expect(onStart).toHaveBeenCalledTimes(1)
    expect(cb).not.toHaveBeenCalled()
  })

  it('calls onEnd after callback completes', async () => {
    const cb = vi.fn()
    const onEnd = vi.fn()
    renderHook(() => useDebouncedAsync(cb, ['value'], { delayMs: DELAY_MS, onEnd }))

    expect(onEnd).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(DELAY_MS)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('calls onEnd after async callback completes', async () => {
    const cb = vi.fn().mockResolvedValue(undefined)
    const onEnd = vi.fn()
    renderHook(() => useDebouncedAsync(cb, ['value'], { delayMs: DELAY_MS, onEnd }))

    await vi.advanceTimersByTimeAsync(DELAY_MS)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('calls onEnd even when callback throws', async () => {
    const cb = vi.fn().mockRejectedValue(new Error('test error'))
    const onEnd = vi.fn()
    renderHook(() => useDebouncedAsync(cb, ['value'], { delayMs: DELAY_MS, onEnd }))

    await vi.advanceTimersByTimeAsync(DELAY_MS)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('cancels pending callback when dependencies change', async () => {
    const cb = vi.fn()
    const { rerender } = renderHook(
      ({ deps }) => useDebouncedAsync(cb, deps, { delayMs: DELAY_MS }),
      { initialProps: { deps: ['value1'] } }
    )

    // Advance halfway through delay
    await vi.advanceTimersByTimeAsync(DELAY_MS / 2)
    expect(cb).not.toHaveBeenCalled()

    // Change dependencies
    rerender({ deps: ['value2'] })

    // Complete original delay — should still not have called
    await vi.advanceTimersByTimeAsync(DELAY_MS / 2)
    expect(cb).not.toHaveBeenCalled()

    // Complete new delay
    await vi.advanceTimersByTimeAsync(DELAY_MS / 2)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('calls onStart multiple times when dependencies change multiple times', () => {
    const cb = vi.fn()
    const onStart = vi.fn()
    const { rerender } = renderHook(
      ({ deps }) => useDebouncedAsync(cb, deps, { delayMs: DELAY_MS, onStart }),
      { initialProps: { deps: ['value1'] } }
    )

    expect(onStart).toHaveBeenCalledTimes(1)

    rerender({ deps: ['value2'] })
    expect(onStart).toHaveBeenCalledTimes(2)

    rerender({ deps: ['value3'] })
    expect(onStart).toHaveBeenCalledTimes(3)
  })

  it('only calls callback once for the final dependency value', async () => {
    const cb = vi.fn()
    const { rerender } = renderHook(
      ({ deps }) => useDebouncedAsync(cb, deps, { delayMs: DELAY_MS }),
      { initialProps: { deps: ['value1'] } }
    )

    rerender({ deps: ['value2'] })
    rerender({ deps: ['value3'] })

    // All timers from previous renders should be cancelled
    await vi.advanceTimersByTimeAsync(DELAY_MS)
    expect(cb).toHaveBeenCalledTimes(1) // Only once, for 'value3'
  })

  it('cleans up on unmount', async () => {
    const cb = vi.fn()
    const onEnd = vi.fn()
    const { unmount } = renderHook(() =>
      useDebouncedAsync(cb, ['value'], { delayMs: DELAY_MS, onEnd })
    )

    unmount()

    await vi.advanceTimersByTimeAsync(DELAY_MS)
    expect(cb).not.toHaveBeenCalled()
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('does not call onEnd on unmount during async callback execution', async () => {
    let resolveCallback: () => void
    const cb = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCallback = resolve
        })
    )
    const onEnd = vi.fn()
    const { unmount } = renderHook(() =>
      useDebouncedAsync(cb, ['value'], { delayMs: DELAY_MS, onEnd })
    )

    await vi.advanceTimersByTimeAsync(DELAY_MS)
    expect(cb).toHaveBeenCalledTimes(1)

    // Unmount while callback is still running
    unmount()

    // Resolve the callback
    resolveCallback!()
    await vi.waitFor(() => {})

    // onEnd should not be called because unmount set cancelled=true
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('uses default delay of 1000ms when delayMs not provided', async () => {
    const cb = vi.fn()
    renderHook(() => useDebouncedAsync(cb, ['value']))

    await vi.advanceTimersByTimeAsync(999)
    expect(cb).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('respects custom delay', async () => {
    const cb = vi.fn()
    const CUSTOM_DELAY = 2500
    renderHook(() => useDebouncedAsync(cb, ['value'], { delayMs: CUSTOM_DELAY }))

    await vi.advanceTimersByTimeAsync(CUSTOM_DELAY - 1)
    expect(cb).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('handles multiple dependencies correctly', async () => {
    const cb = vi.fn()
    const { rerender } = renderHook(
      ({ deps }) => useDebouncedAsync(cb, deps, { delayMs: DELAY_MS }),
      { initialProps: { deps: ['a', 'b', 'c'] } }
    )

    await vi.advanceTimersByTimeAsync(DELAY_MS)
    expect(cb).toHaveBeenCalledTimes(1)

    // Change one dependency
    rerender({ deps: ['a', 'b', 'd'] })
    await vi.advanceTimersByTimeAsync(DELAY_MS)
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('keeps callback ref fresh without retriggering debounce', async () => {
    let callbackValue = 'initial'
    const onStart = vi.fn()

    const { rerender } = renderHook(
      ({ cb }) => useDebouncedAsync(cb, ['stable'], { delayMs: DELAY_MS, onStart }),
      {
        initialProps: {
          cb: () => {
            callbackValue = 'first'
          }
        }
      }
    )

    expect(onStart).toHaveBeenCalledTimes(1)

    // Update callback but keep dependencies same
    rerender({
      cb: () => {
        callbackValue = 'second'
      }
    })

    // onStart should not be called again (dependencies didn't change)
    expect(onStart).toHaveBeenCalledTimes(1)

    // Callback should use latest version
    await vi.advanceTimersByTimeAsync(DELAY_MS)
    expect(callbackValue).toBe('second')
  })
})
