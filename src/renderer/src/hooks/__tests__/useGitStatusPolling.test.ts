import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGitStatusPolling } from '../useGitStatusPolling'

// Mock useVisibilityAwareInterval to prevent timer side-effects
const mockUseVisibilityAwareInterval = vi.fn()
vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: (...args: unknown[]) => mockUseVisibilityAwareInterval(...args)
}))

// Mock the gitTree store
const mockFetchStatus = vi.fn().mockResolvedValue(undefined)
let mockActiveRepo: string | null = '/Users/test/repos/bde'

vi.mock('../../stores/gitTree', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({ activeRepo: mockActiveRepo, fetchStatus: mockFetchStatus })
  )
  ;(store as any).getState = () => ({ activeRepo: mockActiveRepo, fetchStatus: mockFetchStatus })
  return { useGitTreeStore: store }
})

describe('useGitStatusPolling', () => {
  beforeEach(() => {
    mockFetchStatus.mockClear()
    mockUseVisibilityAwareInterval.mockClear()
    mockActiveRepo = '/Users/test/repos/bde'
  })

  it('renders without error', () => {
    expect(() => {
      renderHook(() => useGitStatusPolling())
    }).not.toThrow()
  })

  it('registers useVisibilityAwareInterval with POLL_GIT_STATUS_INTERVAL when repo is active', () => {
    renderHook(() => useGitStatusPolling())
    expect(mockUseVisibilityAwareInterval).toHaveBeenCalledWith(expect.any(Function), 30_000)
  })

  it('passes null interval when no active repo', () => {
    mockActiveRepo = null
    renderHook(() => useGitStatusPolling())
    expect(mockUseVisibilityAwareInterval).toHaveBeenCalledWith(expect.any(Function), null)
  })

  it('poll callback calls fetchStatus with activeRepo', () => {
    renderHook(() => useGitStatusPolling())
    // Extract the poll callback passed to useVisibilityAwareInterval
    const pollFn = mockUseVisibilityAwareInterval.mock.calls[0][0]
    pollFn()
    expect(mockFetchStatus).toHaveBeenCalledWith('/Users/test/repos/bde')
  })

  it('poll callback does not call fetchStatus when no activeRepo', () => {
    mockActiveRepo = null
    renderHook(() => useGitStatusPolling())
    const pollFn = mockUseVisibilityAwareInterval.mock.calls[0][0]
    pollFn()
    expect(mockFetchStatus).not.toHaveBeenCalled()
  })
})
