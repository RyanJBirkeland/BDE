import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDashboardPolling } from '../useDashboardPolling'

// Mock useBackoffInterval to prevent timer side-effects
const mockUseBackoffInterval = vi.fn()
vi.mock('../useBackoffInterval', () => ({
  useBackoffInterval: (...args: unknown[]) => mockUseBackoffInterval(...args)
}))

// Mock the dashboardData store
const mockFetchAll = vi.fn().mockResolvedValue(undefined)

vi.mock('../../stores/dashboardData', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) => sel({ fetchAll: mockFetchAll }))
  ;(store as any).getState = () => ({ fetchAll: mockFetchAll })
  return { useDashboardDataStore: store }
})

describe('useDashboardPolling', () => {
  beforeEach(() => {
    mockFetchAll.mockClear()
    mockUseBackoffInterval.mockClear()
    vi.mocked(window.api.sprint.onExternalChange).mockReturnValue(() => {})
  })

  it('renders without error', () => {
    expect(() => {
      renderHook(() => useDashboardPolling())
    }).not.toThrow()
  })

  it('calls fetchAll on mount', () => {
    renderHook(() => useDashboardPolling())
    expect(mockFetchAll).toHaveBeenCalledTimes(1)
  })

  it('registers useBackoffInterval with fetchAll and POLL_DASHBOARD_INTERVAL', () => {
    renderHook(() => useDashboardPolling())
    expect(mockUseBackoffInterval).toHaveBeenCalledWith(mockFetchAll, 60_000)
  })

  it('registers an external sprint change listener', () => {
    renderHook(() => useDashboardPolling())
    expect(window.api.sprint.onExternalChange).toHaveBeenCalled()
  })

  it('cleans up external sprint change listener on unmount', () => {
    const unsubscribe = vi.fn()
    vi.mocked(window.api.sprint.onExternalChange).mockReturnValue(unsubscribe)

    const { unmount } = renderHook(() => useDashboardPolling())
    unmount()

    expect(unsubscribe).toHaveBeenCalled()
  })
})
