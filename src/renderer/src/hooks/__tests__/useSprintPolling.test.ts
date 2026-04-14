import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSprintPolling } from '../useSprintPolling'

// Mock useBackoffInterval to prevent timer side-effects
vi.mock('../useBackoffInterval', () => ({
  useBackoffInterval: vi.fn()
}))

// Mock the sprintTasks store
const mockLoadData = vi.fn().mockResolvedValue(undefined)
const mockTasks: unknown[] = []

vi.mock('../../stores/sprintTasks', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({ tasks: mockTasks, loadData: mockLoadData })
  )
  ;(store as any).getState = () => ({ tasks: mockTasks, loadData: mockLoadData })
  return {
    useSprintTasks: store,
    selectActiveTaskCount: (s: { tasks: { status: string }[] }) =>
      s.tasks.filter((t) => t.status === 'active').length
  }
})

describe('useSprintPolling', () => {
  beforeEach(() => {
    mockLoadData.mockClear()
    vi.mocked(window.api.sprint.onExternalChange).mockReturnValue(() => {})
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
    expect(window.api.sprint.onExternalChange).toHaveBeenCalledWith(mockLoadData)
  })

  it('cleans up external sprint change listener on unmount', () => {
    const unsubscribe = vi.fn()
    vi.mocked(window.api.sprint.onExternalChange).mockReturnValue(unsubscribe)

    const { unmount } = renderHook(() => useSprintPolling())
    unmount()

    expect(unsubscribe).toHaveBeenCalled()
  })
})
