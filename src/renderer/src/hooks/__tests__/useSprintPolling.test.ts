import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSprintPolling } from '../useSprintPolling'

// Mock useVisibilityAwareInterval to prevent timer side-effects
vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn()
}))

// Mock the sprintTasks store
const mockLoadData = vi.fn().mockResolvedValue(undefined)
const mockTasks: unknown[] = []

vi.mock('../../stores/sprintTasks', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({ tasks: mockTasks, loadData: mockLoadData })
  )
  ;(store as any).getState = () => ({ tasks: mockTasks, loadData: mockLoadData })
  return { useSprintTasks: store }
})

describe('useSprintPolling', () => {
  beforeEach(() => {
    mockLoadData.mockClear()
    vi.mocked(window.api.onExternalSprintChange).mockReturnValue(() => {})
  })

  it('renders without error', () => {
    expect(() => {
      renderHook(() => useSprintPolling())
    }).not.toThrow()
  })

  it('calls loadData on mount', () => {
    renderHook(() => useSprintPolling())
    expect(mockLoadData).toHaveBeenCalledTimes(1)
  })

  it('registers an external sprint change listener', () => {
    renderHook(() => useSprintPolling())
    expect(window.api.onExternalSprintChange).toHaveBeenCalledWith(mockLoadData)
  })

  it('cleans up external sprint change listener on unmount', () => {
    const unsubscribe = vi.fn()
    vi.mocked(window.api.onExternalSprintChange).mockReturnValue(unsubscribe)

    const { unmount } = renderHook(() => useSprintPolling())
    unmount()

    expect(unsubscribe).toHaveBeenCalled()
  })
})
