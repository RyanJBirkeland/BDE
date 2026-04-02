import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useVisibilityAwareInterval } from '../useVisibilityAwareInterval'

describe('useVisibilityAwareInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Ensure document.hidden starts as false (visible)
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires callback at the specified interval', () => {
    const cb = vi.fn()
    renderHook(() => useVisibilityAwareInterval(cb, 1000))

    expect(cb).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(cb).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    expect(cb).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(3000)
    expect(cb).toHaveBeenCalledTimes(5)
  })

  it('stops firing when document becomes hidden', () => {
    const cb = vi.fn()
    renderHook(() => useVisibilityAwareInterval(cb, 1000))

    vi.advanceTimersByTime(2000)
    expect(cb).toHaveBeenCalledTimes(2)

    // Hide the document
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    vi.advanceTimersByTime(5000)
    // No additional calls while hidden
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('fires immediately on resume and restarts interval', () => {
    const cb = vi.fn()
    renderHook(() => useVisibilityAwareInterval(cb, 1000))

    vi.advanceTimersByTime(2000)
    expect(cb).toHaveBeenCalledTimes(2)

    // Hide
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    vi.advanceTimersByTime(5000)
    expect(cb).toHaveBeenCalledTimes(2)

    // Resume
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    // Fires immediately on resume
    expect(cb).toHaveBeenCalledTimes(3)

    // Interval resumes
    vi.advanceTimersByTime(1000)
    expect(cb).toHaveBeenCalledTimes(4)
  })

  it('does nothing when intervalMs is null', () => {
    const cb = vi.fn()
    renderHook(() => useVisibilityAwareInterval(cb, null))

    vi.advanceTimersByTime(5000)
    expect(cb).not.toHaveBeenCalled()
  })

  it('cleans up interval and listener on unmount', () => {
    const cb = vi.fn()
    const { unmount } = renderHook(() => useVisibilityAwareInterval(cb, 1000))

    vi.advanceTimersByTime(2000)
    expect(cb).toHaveBeenCalledTimes(2)

    unmount()

    vi.advanceTimersByTime(5000)
    // No additional calls after unmount
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('restarts interval when intervalMs changes', () => {
    const cb = vi.fn()
    const { rerender } = renderHook(({ ms }) => useVisibilityAwareInterval(cb, ms), {
      initialProps: { ms: 1000 as number | null }
    })

    vi.advanceTimersByTime(2000)
    expect(cb).toHaveBeenCalledTimes(2)

    // Switch to 500ms interval
    rerender({ ms: 500 })

    vi.advanceTimersByTime(1000)
    expect(cb).toHaveBeenCalledTimes(4) // 2 more at 500ms rate
  })

  it('uses latest callback without restarting interval', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const { rerender } = renderHook(({ cb }) => useVisibilityAwareInterval(cb, 1000), {
      initialProps: { cb: cb1 }
    })

    vi.advanceTimersByTime(1000)
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).not.toHaveBeenCalled()

    // Change callback
    rerender({ cb: cb2 })

    vi.advanceTimersByTime(1000)
    expect(cb1).toHaveBeenCalledTimes(1) // not called again
    expect(cb2).toHaveBeenCalledTimes(1) // new callback is called
  })
})
