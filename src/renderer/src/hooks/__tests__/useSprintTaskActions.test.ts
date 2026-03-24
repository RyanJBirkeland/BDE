import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSprintTaskActions } from '../useSprintTaskActions'

// Mock sprintTasks store
const mockUpdateTask = vi.fn().mockResolvedValue(undefined)
const mockDeleteTask = vi.fn().mockResolvedValue(undefined)
const mockLaunchTask = vi.fn().mockResolvedValue(undefined)
const mockLoadData = vi.fn().mockResolvedValue(undefined)
const mockSetTasks = vi.fn()
const mockTasks: unknown[] = []

vi.mock('../../stores/sprintTasks', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({
      tasks: mockTasks,
      updateTask: mockUpdateTask,
      deleteTask: mockDeleteTask,
      launchTask: mockLaunchTask,
      loadData: mockLoadData,
      setTasks: mockSetTasks,
    })
  )
  ;(store as any).getState = () => ({
    tasks: mockTasks,
    updateTask: mockUpdateTask,
    deleteTask: mockDeleteTask,
    launchTask: mockLaunchTask,
    loadData: mockLoadData,
    setTasks: mockSetTasks,
  })
  return { useSprintTasks: store }
})

// Mock sprintUI store
const mockSetSelectedTaskId = vi.fn()

vi.mock('../../stores/sprintUI', () => {
  const store = vi.fn((sel: (s: unknown) => unknown) =>
    sel({ selectedTaskId: null, setSelectedTaskId: mockSetSelectedTaskId })
  )
  ;(store as any).getState = () => ({ selectedTaskId: null, setSelectedTaskId: mockSetSelectedTaskId })
  return { useSprintUI: store }
})

// Mock toasts
vi.mock('../../stores/toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

// Mock framer-motion (used by ConfirmModal, which useConfirm depends on)
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
      const { createElement } = require('react')
      return createElement('div', props, children)
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}))

describe('useSprintTaskActions', () => {
  it('returns all expected action functions', () => {
    const { result } = renderHook(() => useSprintTaskActions())

    expect(typeof result.current.handleDragEnd).toBe('function')
    expect(typeof result.current.handleReorder).toBe('function')
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
})
