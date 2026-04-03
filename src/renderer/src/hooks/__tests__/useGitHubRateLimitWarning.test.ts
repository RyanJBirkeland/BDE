import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGitHubRateLimitWarning } from '../useGitHubRateLimitWarning'

// Mock the toast store
vi.mock('../../stores/toasts', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn()
  }
}))

describe('useGitHubRateLimitWarning', () => {
  let rateLimitHandler: ((data: { remaining: number; limit: number; resetEpoch: number }) => void) | null
  let tokenExpiredHandler: (() => void) | null
  const unsubRate = vi.fn()
  const unsubToken = vi.fn()

  beforeEach(() => {
    rateLimitHandler = null
    tokenExpiredHandler = null

    vi.mocked(window.api.onGitHubRateLimitWarning).mockImplementation((handler) => {
      rateLimitHandler = handler
      return unsubRate
    })
    vi.mocked(window.api.onGitHubTokenExpired).mockImplementation((handler) => {
      tokenExpiredHandler = handler
      return unsubToken
    })
  })

  it('subscribes to rate limit and token expired events on mount', () => {
    renderHook(() => useGitHubRateLimitWarning())
    expect(window.api.onGitHubRateLimitWarning).toHaveBeenCalledWith(expect.any(Function))
    expect(window.api.onGitHubTokenExpired).toHaveBeenCalledWith(expect.any(Function))
  })

  it('unsubscribes from both events on unmount', () => {
    const { unmount } = renderHook(() => useGitHubRateLimitWarning())
    unmount()
    expect(unsubRate).toHaveBeenCalled()
    expect(unsubToken).toHaveBeenCalled()
  })

  it('shows info toast when rate limit warning fires', async () => {
    const { toast } = await import('../../stores/toasts')
    renderHook(() => useGitHubRateLimitWarning())

    rateLimitHandler!({ remaining: 10, limit: 5000, resetEpoch: 1710000000 })
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining('10/5000'),
      expect.objectContaining({ durationMs: 8_000 })
    )
  })

  it('shows error toast when token expired fires', async () => {
    const { toast } = await import('../../stores/toasts')
    renderHook(() => useGitHubRateLimitWarning())

    tokenExpiredHandler!()
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('expired'),
      12_000
    )
  })
})
