import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTaskAutoSelect } from '../useTaskAutoSelect'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import type { SprintTask } from '../../../../shared/types'

vi.mock('../../stores/codeReview')
vi.mock('../../stores/sprintTasks')

const createTask = (overrides: Partial<SprintTask> = {}): SprintTask => ({
  id: 'task-1',
  title: 'Test Task',
  status: 'review',
  repo: 'bde',
  spec: 'Test spec',
  prompt: null,
  notes: null,
  priority: 1,
  retry_count: 0,
  fast_fail_count: 0,
  agent_run_id: null,
  pr_number: null,
  pr_status: null,
  pr_url: null,
  claimed_by: null,
  started_at: null,
  completed_at: null,
  template_name: null,
  depends_on: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides
})

describe('useTaskAutoSelect', () => {
  let mockSelectTask: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockSelectTask = vi.fn()
  })

  it('should auto-select when no task is selected and a review task exists', () => {
    const reviewTask = createTask({ id: 'task-1', status: 'review' })

    vi.mocked(useCodeReviewStore).mockImplementation((selector: any) => {
      const state = {
        selectedTaskId: null,
        selectTask: mockSelectTask
      }
      return selector(state)
    })
    vi.mocked(useSprintTasks).mockImplementation((selector: any) => {
      const state = { tasks: [reviewTask] }
      return selector(state)
    })

    renderHook(() => useTaskAutoSelect())

    expect(mockSelectTask).toHaveBeenCalledWith('task-1')
  })

  it('should NOT auto-select when current selection is valid', () => {
    const reviewTask = createTask({ id: 'task-1', status: 'review' })

    vi.mocked(useCodeReviewStore).mockImplementation((selector: any) => {
      const state = {
        selectedTaskId: 'task-1',
        selectTask: mockSelectTask
      }
      return selector(state)
    })
    vi.mocked(useSprintTasks).mockImplementation((selector: any) => {
      const state = { tasks: [reviewTask] }
      return selector(state)
    })

    renderHook(() => useTaskAutoSelect())

    expect(mockSelectTask).not.toHaveBeenCalled()
  })

  it('should NOT auto-select when no review tasks exist', () => {
    const doneTask = createTask({ id: 'task-1', status: 'done' })

    vi.mocked(useCodeReviewStore).mockImplementation((selector: any) => {
      const state = {
        selectedTaskId: null,
        selectTask: mockSelectTask
      }
      return selector(state)
    })
    vi.mocked(useSprintTasks).mockImplementation((selector: any) => {
      const state = { tasks: [doneTask] }
      return selector(state)
    })

    renderHook(() => useTaskAutoSelect())

    expect(mockSelectTask).not.toHaveBeenCalled()
  })

  it('should select the most recently updated review task', () => {
    const now = Date.now()
    const olderTask = createTask({
      id: 'task-older',
      status: 'review',
      updated_at: new Date(now - 60000).toISOString() // 1 minute ago
    })
    const newerTask = createTask({
      id: 'task-newer',
      status: 'review',
      updated_at: new Date(now).toISOString() // now
    })

    vi.mocked(useCodeReviewStore).mockImplementation((selector: any) => {
      const state = {
        selectedTaskId: null,
        selectTask: mockSelectTask
      }
      return selector(state)
    })
    vi.mocked(useSprintTasks).mockImplementation((selector: any) => {
      const state = { tasks: [olderTask, newerTask] }
      return selector(state)
    })

    renderHook(() => useTaskAutoSelect())

    expect(mockSelectTask).toHaveBeenCalledWith('task-newer')
  })

  it('should re-select when selected task leaves review status', () => {
    const doneTask = createTask({ id: 'task-1', status: 'done' })
    const reviewTask = createTask({
      id: 'task-2',
      status: 'review',
      updated_at: new Date().toISOString()
    })

    vi.mocked(useCodeReviewStore).mockImplementation((selector: any) => {
      const state = {
        selectedTaskId: 'task-1', // selected task is 'done'
        selectTask: mockSelectTask
      }
      return selector(state)
    })
    vi.mocked(useSprintTasks).mockImplementation((selector: any) => {
      const state = { tasks: [doneTask, reviewTask] }
      return selector(state)
    })

    renderHook(() => useTaskAutoSelect())

    expect(mockSelectTask).toHaveBeenCalledWith('task-2')
  })
})
