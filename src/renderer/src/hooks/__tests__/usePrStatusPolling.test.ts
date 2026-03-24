import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePrStatusPolling } from '../usePrStatusPolling'

// Mock useVisibilityAwareInterval to prevent timer side-effects
vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn(),
}))

// Mock the sprintTasks store
const mockUpdateTask = vi.fn().mockResolvedValue(undefined)
const mockSetPrMergedMap = vi.fn()
const mockTasks: unknown[] = []
const mockPrMergedMap: Record<string, boolean> = {}

vi.mock('../../stores/sprintTasks', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({
      tasks: mockTasks,
      prMergedMap: mockPrMergedMap,
      updateTask: mockUpdateTask,
      setPrMergedMap: mockSetPrMergedMap,
    })
  )
  ;(store as any).getState = () => ({
    tasks: mockTasks,
    prMergedMap: mockPrMergedMap,
    updateTask: mockUpdateTask,
    setPrMergedMap: mockSetPrMergedMap,
  })
  return { useSprintTasks: store }
})

// Mock the prConflicts store
const mockSetConflicts = vi.fn()

vi.mock('../../stores/prConflicts', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({ conflictingTaskIds: new Set(), setConflicts: mockSetConflicts })
  )
  ;(store as any).getState = () => ({ conflictingTaskIds: new Set(), setConflicts: mockSetConflicts })
  return { usePrConflictsStore: store }
})

// Mock toasts
vi.mock('../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

describe('usePrStatusPolling', () => {
  beforeEach(() => {
    mockUpdateTask.mockClear()
    mockSetPrMergedMap.mockClear()
    mockSetConflicts.mockClear()
    vi.mocked(window.api.pollPrStatuses).mockResolvedValue([])
  })

  it('renders without error', () => {
    expect(() => {
      renderHook(() => usePrStatusPolling())
    }).not.toThrow()
  })

  it('does not call pollPrStatuses when there are no tasks with PRs', () => {
    renderHook(() => usePrStatusPolling())
    // Since mockTasks is empty, pollPrStatuses should not be invoked
    expect(window.api.pollPrStatuses).not.toHaveBeenCalled()
  })
})
