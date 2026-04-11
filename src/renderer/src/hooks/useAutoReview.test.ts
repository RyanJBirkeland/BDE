import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAutoReview } from './useAutoReview'
import { useReviewPartnerStore } from '../stores/reviewPartner'

describe('useAutoReview', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllTimers()
    vi.clearAllMocks()
    useReviewPartnerStore.setState({ reviewByTask: {}, messagesByTask: {} })
    ;(window as any).api = {
      review: {
        autoReview: vi.fn().mockResolvedValue({
          qualityScore: 90,
          issuesCount: 0,
          filesCount: 0,
          openingMessage: 'ok',
          findings: { perFile: [] },
          model: 'claude-opus-4-6',
          createdAt: 0,
        }),
        onChatChunk: () => () => {},
      },
    }
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fires autoReview after 2 s when task is in review status', async () => {
    const spy = vi.spyOn(useReviewPartnerStore.getState(), 'autoReview')
    renderHook(() => useAutoReview('task-1', 'review'))
    expect(spy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(spy).toHaveBeenCalledWith('task-1')
  })

  it('does NOT fire when status is not review', async () => {
    const spy = vi.spyOn(useReviewPartnerStore.getState(), 'autoReview')
    renderHook(() => useAutoReview('task-1', 'active'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(spy).not.toHaveBeenCalled()
  })

  it('does NOT fire when taskId is null', async () => {
    const spy = vi.spyOn(useReviewPartnerStore.getState(), 'autoReview')
    renderHook(() => useAutoReview(null, 'review'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(spy).not.toHaveBeenCalled()
  })

  it('cancels pending fire when task changes before debounce elapses', async () => {
    const spy = vi.spyOn(useReviewPartnerStore.getState(), 'autoReview')
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useAutoReview(id, 'review'),
      { initialProps: { id: 'task-1' } }
    )
    await vi.advanceTimersByTimeAsync(1000)
    rerender({ id: 'task-2' })
    await vi.advanceTimersByTimeAsync(1000)
    // Only 1000ms elapsed since rerender — debounce not yet fired
    expect(spy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('task-2')
  })
})
