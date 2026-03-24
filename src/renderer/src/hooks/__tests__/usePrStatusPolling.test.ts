import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePrStatusPolling } from '../usePrStatusPolling'
import type { SprintTask } from '../../../../shared/types'

// Mock useVisibilityAwareInterval to prevent timer side-effects
vi.mock('../useVisibilityAwareInterval', () => ({
  useVisibilityAwareInterval: vi.fn(),
}))

// Mutable state that tests can override
let currentTasks: SprintTask[] = []
let currentPrMergedMap: Record<string, boolean> = {}

// Mock the sprintTasks store
const mockUpdateTask = vi.fn().mockResolvedValue(undefined)
const mockSetPrMergedMap = vi.fn()

vi.mock('../../stores/sprintTasks', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({
      get tasks() { return currentTasks },
      get prMergedMap() { return currentPrMergedMap },
      updateTask: mockUpdateTask,
      setPrMergedMap: mockSetPrMergedMap,
    })
  )
  ;(store as any).getState = () => ({
    get tasks() { return currentTasks },
    get prMergedMap() { return currentPrMergedMap },
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
const mockToastError = vi.fn()
vi.mock('../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => mockToastError(...args),
    info: vi.fn(),
  },
}))

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: `task-${Math.random().toString(36).slice(2)}`,
    title: 'Test task',
    repo: 'BDE',
    prompt: null,
    priority: 1,
    status: 'active',
    notes: null,
    spec: null,
    agent_run_id: null,
    pr_number: null,
    pr_status: null,
    pr_mergeable_state: null,
    pr_url: null,
    claimed_by: null,
    started_at: null,
    completed_at: null,
    retry_count: 0,
    fast_fail_count: 0,
    template_name: null,
    depends_on: null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('usePrStatusPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentTasks = []
    currentPrMergedMap = {}
    mockUpdateTask.mockClear()
    mockSetPrMergedMap.mockClear()
    mockSetConflicts.mockClear()
    mockToastError.mockClear()
    vi.mocked(window.api.pollPrStatuses).mockResolvedValue([])
  })

  it('renders without error', () => {
    expect(() => {
      renderHook(() => usePrStatusPolling())
    }).not.toThrow()
  })

  it('does not call pollPrStatuses when there are no tasks with PRs', () => {
    renderHook(() => usePrStatusPolling())
    // Since currentTasks is empty, pollPrStatuses should not be invoked
    expect(window.api.pollPrStatuses).not.toHaveBeenCalled()
  })

  it('does not poll when tasks have no pr_url', async () => {
    currentTasks = [makeTask({ pr_url: null })]
    renderHook(() => usePrStatusPolling())
    await act(async () => {})
    expect(window.api.pollPrStatuses).not.toHaveBeenCalled()
  })

  it('calls pollPrStatuses with tasks that have pr_url', async () => {
    const task = makeTask({ id: 'task-1', pr_url: 'https://github.com/org/repo/pull/1' })
    currentTasks = [task]

    vi.mocked(window.api.pollPrStatuses).mockResolvedValue([
      { taskId: 'task-1', merged: false, state: 'open', mergedAt: null, mergeableState: 'clean' },
    ])

    renderHook(() => usePrStatusPolling())

    await act(async () => {})

    expect(window.api.pollPrStatuses).toHaveBeenCalledWith([
      { taskId: 'task-1', prUrl: 'https://github.com/org/repo/pull/1' },
    ])
  })

  it('skips tasks already in prMergedMap as merged', async () => {
    const task = makeTask({ id: 'task-merged', pr_url: 'https://github.com/org/repo/pull/2' })
    currentTasks = [task]
    currentPrMergedMap = { 'task-merged': true }

    renderHook(() => usePrStatusPolling())
    await act(async () => {})

    expect(window.api.pollPrStatuses).not.toHaveBeenCalled()
  })

  it('calls setPrMergedMap when a PR is newly merged', async () => {
    const task = makeTask({ id: 'task-1', pr_url: 'https://github.com/org/repo/pull/1' })
    currentTasks = [task]

    vi.mocked(window.api.pollPrStatuses).mockResolvedValue([
      { taskId: 'task-1', merged: true, state: 'closed', mergedAt: '2026-01-01T00:00:00Z', mergeableState: 'clean' },
    ])

    renderHook(() => usePrStatusPolling())

    await act(async () => {})

    // setPrMergedMap called with a function (updater pattern)
    expect(mockSetPrMergedMap).toHaveBeenCalled()
    // The updater should produce the merged state
    const updater = mockSetPrMergedMap.mock.calls[0][0]
    const result = updater({})
    expect(result).toEqual({ 'task-1': true })
  })

  it('updates pr_status to merged for merged PRs', async () => {
    const task = makeTask({ id: 'task-1', pr_url: 'https://github.com/org/repo/pull/1' })
    currentTasks = [task]

    vi.mocked(window.api.pollPrStatuses).mockResolvedValue([
      { taskId: 'task-1', merged: true, state: 'closed', mergedAt: '2026-01-01T00:00:00Z', mergeableState: 'clean' },
    ])

    renderHook(() => usePrStatusPolling())

    await act(async () => {})

    expect(mockUpdateTask).toHaveBeenCalledWith('task-1', { pr_status: 'merged' })
  })

  it('sets conflicts when PR has dirty mergeableState', async () => {
    const task = makeTask({ id: 'task-1', pr_url: 'https://github.com/org/repo/pull/1' })
    currentTasks = [task]

    vi.mocked(window.api.pollPrStatuses).mockResolvedValue([
      { taskId: 'task-1', merged: false, state: 'open', mergedAt: null, mergeableState: 'dirty' },
    ])

    renderHook(() => usePrStatusPolling())

    await act(async () => {})

    expect(mockSetConflicts).toHaveBeenCalledWith(['task-1'])
  })

  it('toasts when new conflicts appear', async () => {
    const task = makeTask({ id: 'task-conflict', pr_url: 'https://github.com/org/repo/pull/1' })
    currentTasks = [task]

    vi.mocked(window.api.pollPrStatuses).mockResolvedValue([
      { taskId: 'task-conflict', merged: false, state: 'open', mergedAt: null, mergeableState: 'dirty' },
    ])

    renderHook(() => usePrStatusPolling())

    await act(async () => {})

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('merge conflict'))
  })

  it('updates pr_mergeable_state for tasks with mergeableState', async () => {
    const task = makeTask({ id: 'task-1', pr_url: 'https://github.com/org/repo/pull/1' })
    currentTasks = [task]

    vi.mocked(window.api.pollPrStatuses).mockResolvedValue([
      { taskId: 'task-1', merged: false, state: 'open', mergedAt: null, mergeableState: 'clean' },
    ])

    renderHook(() => usePrStatusPolling())

    await act(async () => {})

    expect(mockUpdateTask).toHaveBeenCalledWith('task-1', { pr_mergeable_state: 'clean' })
  })

  it('does not throw when pollPrStatuses rejects (graceful degradation)', async () => {
    const task = makeTask({ id: 'task-1', pr_url: 'https://github.com/org/repo/pull/1' })
    currentTasks = [task]

    vi.mocked(window.api.pollPrStatuses).mockRejectedValue(new Error('gh CLI unavailable'))

    expect(() => {
      renderHook(() => usePrStatusPolling())
    }).not.toThrow()

    await act(async () => {})

    // No error propagated, no updateTask called
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  it('setPrMergedMap updater returns prev unchanged when nothing changed', async () => {
    const task = makeTask({ id: 'task-1', pr_url: 'https://github.com/org/repo/pull/1' })
    currentTasks = [task]

    // merged: false with prev already having false
    vi.mocked(window.api.pollPrStatuses).mockResolvedValue([
      { taskId: 'task-1', merged: false, state: 'open', mergedAt: null, mergeableState: null },
    ])

    renderHook(() => usePrStatusPolling())
    await act(async () => {})

    const updater = mockSetPrMergedMap.mock.calls[0][0]
    const prev = { 'task-1': false }
    const result = updater(prev)
    // No change: should return the same object reference
    expect(result).toBe(prev)
  })
})
