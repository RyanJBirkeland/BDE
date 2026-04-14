import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSprintTaskActions } from '../useSprintTaskActions'
import type { SprintTask } from '../../../../shared/types'
import { nowIso } from '../../../../shared/time'

// Mock sprintTasks store
const mockUpdateTask = vi.fn().mockResolvedValue(undefined)
const mockDeleteTask = vi.fn().mockResolvedValue(undefined)
const mockCreateTask = vi.fn().mockResolvedValue('new-task-id')
const mockBatchDeleteTasks = vi.fn().mockResolvedValue(undefined)
const mockGenerateSpec = vi.fn().mockResolvedValue(undefined)
const mockLaunchTask = vi.fn().mockResolvedValue(undefined)
const mockLoadData = vi.fn().mockResolvedValue(undefined)
const mockTasks: unknown[] = []

vi.mock('../../stores/sprintTasks', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({
      tasks: mockTasks,
      updateTask: mockUpdateTask,
      deleteTask: mockDeleteTask,
      createTask: mockCreateTask,
      batchDeleteTasks: mockBatchDeleteTasks,
      generateSpec: mockGenerateSpec,
      launchTask: mockLaunchTask,
      loadData: mockLoadData
    })
  )
  ;(store as any).getState = () => ({
    tasks: mockTasks,
    updateTask: mockUpdateTask,
    deleteTask: mockDeleteTask,
    createTask: mockCreateTask,
    batchDeleteTasks: mockBatchDeleteTasks,
    generateSpec: mockGenerateSpec,
    launchTask: mockLaunchTask,
    loadData: mockLoadData
  })
  return { useSprintTasks: store }
})

const mockClearTaskIfSelected = vi.fn()
const mockAddGeneratingId = vi.fn()
const mockRemoveGeneratingId = vi.fn()
const mockSetSelectedTaskId = vi.fn()
const mockSetDrawerOpen = vi.fn()

vi.mock('../../stores/sprintSelection', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({
      clearTaskIfSelected: mockClearTaskIfSelected,
      setSelectedTaskId: mockSetSelectedTaskId,
      setDrawerOpen: mockSetDrawerOpen
    })
  )
  ;(store as any).getState = () => ({
    clearTaskIfSelected: mockClearTaskIfSelected,
    setSelectedTaskId: mockSetSelectedTaskId,
    setDrawerOpen: mockSetDrawerOpen
  })
  return { useSprintSelection: store }
})

vi.mock('../../stores/sprintUI', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({
      addGeneratingId: mockAddGeneratingId,
      removeGeneratingId: mockRemoveGeneratingId
    })
  )
  ;(store as any).getState = () => ({
    addGeneratingId: mockAddGeneratingId,
    removeGeneratingId: mockRemoveGeneratingId
  })
  return { useSprintUI: store }
})

// Mock toasts
vi.mock('../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

// Mock template heuristics
vi.mock('../../../../shared/template-heuristics', () => ({
  detectTemplate: vi.fn().mockReturnValue('feature')
}))

// Mock framer-motion (used by ConfirmModal, which useConfirm depends on)
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
      const { createElement } = require('react')
      return createElement('div', props, children)
    }
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children
}))

function makeTask(overrides: Partial<SprintTask> = {}): SprintTask {
  return {
    id: 'task-1',
    title: 'Test task',
    repo: 'BDE',
    prompt: null,
    priority: 1,
    status: 'queued',
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
    updated_at: nowIso(),
    created_at: nowIso(),
    ...overrides
  }
}

describe('useSprintTaskActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all expected action functions', () => {
    const { result } = renderHook(() => useSprintTaskActions())

    expect(typeof result.current.handleSaveSpec).toBe('function')
    expect(typeof result.current.handleStop).toBe('function')
    expect(typeof result.current.handleRerun).toBe('function')
    expect(typeof result.current.handleRetry).toBe('function')
    expect(typeof result.current.launchTask).toBe('function')
    expect(typeof result.current.deleteTask).toBe('function')
    expect(result.current.confirmProps).toBeDefined()
  })

  it('handleSaveSpec calls updateTask with the spec patch', () => {
    const { result } = renderHook(() => useSprintTaskActions())

    result.current.handleSaveSpec('task-abc', 'new spec content')

    expect(mockUpdateTask).toHaveBeenCalledWith('task-abc', { spec: 'new spec content' })
  })

  it('launchTask is the store launchTask function', () => {
    const { result } = renderHook(() => useSprintTaskActions())
    expect(result.current.launchTask).toBe(mockLaunchTask)
  })

  it('deleteTask wrapper calls both store and UI', async () => {
    const { result } = renderHook(() => useSprintTaskActions())

    await act(async () => {
      await result.current.deleteTask('task-1')
    })

    expect(mockDeleteTask).toHaveBeenCalledWith('task-1')
    expect(mockClearTaskIfSelected).toHaveBeenCalledWith('task-1')
  })

  it('createTask wrapper returns taskId from store', async () => {
    const { result } = renderHook(() => useSprintTaskActions())

    const taskId = await act(async () => {
      return await result.current.createTask({
        title: 'New task',
        repo: 'bde',
        priority: 1,
        spec: 'existing spec'
      })
    })

    expect(taskId).toBe('new-task-id')
    expect(mockCreateTask).toHaveBeenCalled()
  })

  it('createTask triggers spec generation when no spec provided', async () => {
    const { result } = renderHook(() => useSprintTaskActions())

    await act(async () => {
      await result.current.createTask({
        title: 'Quick task',
        repo: 'bde',
        priority: 1
      })
    })

    expect(mockAddGeneratingId).toHaveBeenCalledWith('new-task-id')
    expect(mockGenerateSpec).toHaveBeenCalledWith('new-task-id', 'Quick task', 'bde', 'feature')
  })

  it('createTask skips spec generation when spec provided', async () => {
    const { result } = renderHook(() => useSprintTaskActions())

    await act(async () => {
      await result.current.createTask({
        title: 'Task with spec',
        repo: 'bde',
        priority: 1,
        spec: 'existing spec'
      })
    })

    expect(mockAddGeneratingId).not.toHaveBeenCalled()
    expect(mockGenerateSpec).not.toHaveBeenCalled()
  })

  it('batchDeleteTasks wrapper calls both store and UI', async () => {
    const { result } = renderHook(() => useSprintTaskActions())

    await act(async () => {
      await result.current.batchDeleteTasks(['t1', 't2', 't3'])
    })

    expect(mockBatchDeleteTasks).toHaveBeenCalledWith(['t1', 't2', 't3'])
    expect(mockClearTaskIfSelected).toHaveBeenCalledTimes(3)
    // forEach passes (item, index, array) to the callback
    expect(mockClearTaskIfSelected).toHaveBeenNthCalledWith(1, 't1', 0, ['t1', 't2', 't3'])
    expect(mockClearTaskIfSelected).toHaveBeenNthCalledWith(2, 't2', 1, ['t1', 't2', 't3'])
    expect(mockClearTaskIfSelected).toHaveBeenNthCalledWith(3, 't3', 2, ['t1', 't2', 't3'])
  })

  // --- handleStop ---

  it('handleStop does nothing when task is not active', async () => {
    const { result } = renderHook(() => useSprintTaskActions())
    const task = makeTask({ status: 'done' })

    await act(async () => {
      await result.current.handleStop(task)
    })

    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  it('handleStop cancels task when user confirms and killAgent succeeds', async () => {
    const { toast } = await import('../../stores/toasts')
    vi.mocked(window.api.agentManager.kill).mockResolvedValue({ ok: true })

    const { result } = renderHook(() => useSprintTaskActions())
    const task = makeTask({ agent_run_id: 'run-abc', status: 'active' })

    let promise: Promise<void>
    act(() => {
      promise = result.current.handleStop(task)
    })

    // Confirm the stop dialog
    act(() => {
      result.current.confirmProps.onConfirm()
    })

    await act(async () => {
      await promise!
    })

    expect(window.api.agentManager.kill).toHaveBeenCalledWith(task.id)
    expect(mockUpdateTask).toHaveBeenCalledWith(task.id, { status: 'cancelled' })
    expect(toast.success).toHaveBeenCalledWith('Agent stopped')
  })

  it('handleStop shows error when killAgent returns not ok', async () => {
    const { toast } = await import('../../stores/toasts')
    vi.mocked(window.api.agentManager.kill).mockResolvedValue({ ok: false })

    const { result } = renderHook(() => useSprintTaskActions())
    const task = makeTask({ agent_run_id: 'run-abc', status: 'active' })

    let promise: Promise<void>
    act(() => {
      promise = result.current.handleStop(task)
    })

    act(() => {
      result.current.confirmProps.onConfirm()
    })

    await act(async () => {
      await promise!
    })

    expect(mockUpdateTask).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Failed to stop agent')
  })

  it('handleStop shows error when killAgent throws', async () => {
    const { toast } = await import('../../stores/toasts')
    vi.mocked(window.api.agentManager.kill).mockRejectedValue(new Error('IPC error'))

    const { result } = renderHook(() => useSprintTaskActions())
    const task = makeTask({ agent_run_id: 'run-abc', status: 'active' })

    let promise: Promise<void>
    act(() => {
      promise = result.current.handleStop(task)
    })

    act(() => {
      result.current.confirmProps.onConfirm()
    })

    await act(async () => {
      await promise!
    })

    expect(toast.error).toHaveBeenCalledWith('IPC error')
  })

  it('handleStop does nothing when user cancels confirm', async () => {
    const { result } = renderHook(() => useSprintTaskActions())
    const task = makeTask({ agent_run_id: 'run-abc', status: 'active' })

    let promise: Promise<void>
    act(() => {
      promise = result.current.handleStop(task)
    })

    act(() => {
      result.current.confirmProps.onCancel()
    })

    await act(async () => {
      await promise!
    })

    expect(window.api.agentManager.kill).not.toHaveBeenCalled()
    expect(mockUpdateTask).not.toHaveBeenCalled()
  })

  // --- handleRerun ---

  it('handleRerun creates new task and reloads data on success', async () => {
    const { toast } = await import('../../stores/toasts')
    vi.mocked(window.api.sprint.create).mockResolvedValue({} as any)

    const { result } = renderHook(() => useSprintTaskActions())
    const task = makeTask({
      title: 'My task',
      repo: 'BDE',
      prompt: 'do the thing',
      spec: '# Spec',
      priority: 2,
      status: 'done'
    })

    await act(async () => {
      await result.current.handleRerun(task)
    })

    expect(window.api.sprint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'My task',
        repo: 'BDE',
        prompt: 'do the thing',
        spec: '# Spec',
        priority: 2,
        status: 'queued'
      })
    )
    expect(mockLoadData).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Task re-queued as new ticket')
  })

  it('handleRerun shows error when sprint.create throws', async () => {
    const { toast } = await import('../../stores/toasts')
    vi.mocked(window.api.sprint.create).mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useSprintTaskActions())
    const task = makeTask({ status: 'failed' as any })

    await act(async () => {
      await result.current.handleRerun(task)
    })

    expect(toast.error).toHaveBeenCalledWith('Network error')
    expect(mockLoadData).not.toHaveBeenCalled()
  })

  it('handleRerun uses title as prompt when prompt is null', async () => {
    vi.mocked(window.api.sprint.create).mockResolvedValue({} as any)

    const { result } = renderHook(() => useSprintTaskActions())
    const task = makeTask({ title: 'Fallback title', prompt: null })

    await act(async () => {
      await result.current.handleRerun(task)
    })

    expect(window.api.sprint.create).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Fallback title' })
    )
  })
})
