import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSprintTaskActions } from '../useSprintTaskActions'
import type { SprintTask } from '../../../../shared/types'

// Mock sprintTasks store
const mockUpdateTask = vi.fn().mockResolvedValue(undefined)
const mockDeleteTask = vi.fn().mockResolvedValue(undefined)
const mockLaunchTask = vi.fn().mockResolvedValue(undefined)
const mockLoadData = vi.fn().mockResolvedValue(undefined)
const mockTasks: unknown[] = []

vi.mock('../../stores/sprintTasks', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({
      tasks: mockTasks,
      updateTask: mockUpdateTask,
      deleteTask: mockDeleteTask,
      launchTask: mockLaunchTask,
      loadData: mockLoadData
    })
  )
  ;(store as any).getState = () => ({
    tasks: mockTasks,
    updateTask: mockUpdateTask,
    deleteTask: mockDeleteTask,
    launchTask: mockLaunchTask,
    loadData: mockLoadData
  })
  return { useSprintTasks: store }
})

// Mock sprintUI store
const mockSetSelectedTaskId = vi.fn()

vi.mock('../../stores/sprintUI', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({ selectedTaskId: null, setSelectedTaskId: mockSetSelectedTaskId })
  )
  ;(store as any).getState = () => ({
    selectedTaskId: null,
    setSelectedTaskId: mockSetSelectedTaskId
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
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    ...overrides
  }
}

describe('useSprintTaskActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all expected action functions', () => {
    const { result } = renderHook(() => useSprintTaskActions())

    expect(typeof result.current.handlePushToSprint).toBe('function')
    expect(typeof result.current.handleViewSpec).toBe('function')
    expect(typeof result.current.handleSaveSpec).toBe('function')
    expect(typeof result.current.handleMarkDone).toBe('function')
    expect(typeof result.current.handleStop).toBe('function')
    expect(typeof result.current.handleRerun).toBe('function')
    expect(typeof result.current.handleUpdateTitle).toBe('function')
    expect(typeof result.current.handleUpdatePriority).toBe('function')
    expect(typeof result.current.launchTask).toBe('function')
    expect(typeof result.current.deleteTask).toBe('function')
    expect(result.current.confirmProps).toBeDefined()
  })

  it('handleViewSpec calls setSelectedTaskId with the task id', () => {
    const { result } = renderHook(() => useSprintTaskActions())
    const mockTask = { id: 'task-123' } as Parameters<typeof result.current.handleViewSpec>[0]

    result.current.handleViewSpec(mockTask)

    expect(mockSetSelectedTaskId).toHaveBeenCalledWith('task-123')
  })

  it('handleSaveSpec calls updateTask with the spec patch', () => {
    const { result } = renderHook(() => useSprintTaskActions())

    result.current.handleSaveSpec('task-abc', 'new spec content')

    expect(mockUpdateTask).toHaveBeenCalledWith('task-abc', { spec: 'new spec content' })
  })

  it('handleUpdateTitle calls updateTask with title patch', () => {
    const { result } = renderHook(() => useSprintTaskActions())

    result.current.handleUpdateTitle({ id: 'task-1', title: 'New Title' })

    expect(mockUpdateTask).toHaveBeenCalledWith('task-1', { title: 'New Title' })
  })

  it('handleUpdatePriority calls updateTask with priority patch', () => {
    const { result } = renderHook(() => useSprintTaskActions())

    result.current.handleUpdatePriority({ id: 'task-1', priority: 3 })

    expect(mockUpdateTask).toHaveBeenCalledWith('task-1', { priority: 3 })
  })

  it('launchTask is the store launchTask function', () => {
    const { result } = renderHook(() => useSprintTaskActions())
    expect(result.current.launchTask).toBe(mockLaunchTask)
  })

  it('deleteTask is the store deleteTask function', () => {
    const { result } = renderHook(() => useSprintTaskActions())
    expect(result.current.deleteTask).toBe(mockDeleteTask)
  })

  // --- handlePushToSprint ---

  it('handlePushToSprint calls updateTask with queued status and shows success toast', async () => {
    const { toast } = await import('../../stores/toasts')
    const { result } = renderHook(() => useSprintTaskActions())
    const task = makeTask({ status: 'backlog' })
    await result.current.handlePushToSprint(task)
    expect(mockUpdateTask).toHaveBeenCalledWith(task.id, { status: 'queued' })
    expect(toast.success).toHaveBeenCalledWith('Pushed to Sprint')
  })

  // --- handleMarkDone ---

  it('handleMarkDone updates task to done when user confirms (no PR)', async () => {
    const { toast } = await import('../../stores/toasts')
    const { result } = renderHook(() => useSprintTaskActions())
    const task = makeTask({ id: 'task-done', status: 'active', pr_url: null })

    // Start the mark done — it will wait for confirm
    let promise: Promise<void>
    act(() => {
      promise = result.current.handleMarkDone(task)
    })

    // confirmProps should now be open
    expect(result.current.confirmProps.open).toBe(true)
    expect(result.current.confirmProps.message).toBe('Mark as done?')

    // Confirm
    act(() => {
      result.current.confirmProps.onConfirm()
    })

    await act(async () => {
      await promise!
    })

    expect(mockUpdateTask).toHaveBeenCalledWith(
      'task-done',
      expect.objectContaining({ status: 'done' })
    )
    expect(toast.success).toHaveBeenCalledWith('Marked as done')
  })

  it('handleMarkDone shows PR warning message when task has pr_url', async () => {
    const { result } = renderHook(() => useSprintTaskActions())
    const task = makeTask({ status: 'active', pr_url: 'https://github.com/org/repo/pull/1' })

    act(() => {
      void result.current.handleMarkDone(task)
    })

    expect(result.current.confirmProps.message).toContain('open PR will remain open')

    act(() => {
      result.current.confirmProps.onCancel()
    })
  })

  it('handleMarkDone does nothing when user cancels', async () => {
    const { toast } = await import('../../stores/toasts')
    const { result } = renderHook(() => useSprintTaskActions())
    const task = makeTask({ status: 'active' })

    let promise: Promise<void>
    act(() => {
      promise = result.current.handleMarkDone(task)
    })

    act(() => {
      result.current.confirmProps.onCancel()
    })

    await act(async () => {
      await promise!
    })

    expect(mockUpdateTask).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
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
