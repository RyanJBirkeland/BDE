import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGitStatusPolling } from '../useGitStatusPolling'

// Mock useBackoffInterval to prevent timer side-effects
const mockUseBackoffInterval = vi.fn()
vi.mock('../useBackoffInterval', () => ({
  useBackoffInterval: (...args: unknown[]) => mockUseBackoffInterval(...args)
}))

// Mock the gitTree store
const mockFetchStatus = vi.fn().mockResolvedValue(undefined)
let mockActiveRepo: string | null = '/Users/test/repos/fleet'

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
    mockUseBackoffInterval.mockClear()
    mockActiveRepo = '/Users/test/repos/fleet'
  })

  it('renders without error', () => {
    expect(() => {
      renderHook(() => useGitStatusPolling())
    }).not.toThrow()
  })

  it('registers useBackoffInterval with POLL_GIT_STATUS_INTERVAL when repo is active', () => {
    renderHook(() => useGitStatusPolling())
    expect(mockUseBackoffInterval).toHaveBeenCalledWith(expect.any(Function), 30_000)
  })

  it('passes null interval when no active repo', () => {
    mockActiveRepo = null
    renderHook(() => useGitStatusPolling())
    expect(mockUseBackoffInterval).toHaveBeenCalledWith(expect.any(Function), null)
  })

  it('poll callback calls fetchStatus with activeRepo', () => {
    renderHook(() => useGitStatusPolling())
    // Extract the poll callback passed to useBackoffInterval
    const pollFn = mockUseBackoffInterval.mock.calls[0][0]
    pollFn()
    expect(mockFetchStatus).toHaveBeenCalledWith('/Users/test/repos/fleet')
  })

  it('poll callback does not call fetchStatus when no activeRepo', () => {
    mockActiveRepo = null
    renderHook(() => useGitStatusPolling())
    const pollFn = mockUseBackoffInterval.mock.calls[0][0]
    pollFn()
    expect(mockFetchStatus).not.toHaveBeenCalled()
  })
})
