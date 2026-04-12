import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReviewCommits } from '../useReviewCommits'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import type { SprintTask } from '../../../../shared/types'

// Mock window.api
const mockGetCommits = vi.fn()

vi.stubGlobal('window', {
  api: {
    review: {
      getCommits: mockGetCommits
    }
  }
})

describe('useReviewCommits', () => {
  beforeEach(() => {
    // Reset stores
    useCodeReviewStore.setState({
      commits: [],
      loading: {}
    })
    useSprintTasks.setState({ tasks: [] })

    // Reset mocks
    mockGetCommits.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty state when taskId is null', async () => {
    const { result } = renderHook(() => useReviewCommits(null))

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })

    expect(result.current.commits).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('should load commits on success', async () => {
    const task: SprintTask = {
      id: 'task-1',
      worktree_path: '/path/to/worktree'
    } as SprintTask

    useSprintTasks.setState({ tasks: [task] })

    const mockCommits = [
      { hash: 'abc123', message: 'feat: add feature', author: 'Ryan', date: '2026-04-11' },
      { hash: 'def456', message: 'fix: bug fix', author: 'Ryan', date: '2026-04-10' }
    ]

    mockGetCommits.mockResolvedValue({ commits: mockCommits })

    const { result } = renderHook(() => useReviewCommits('task-1'))

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    expect(mockGetCommits).toHaveBeenCalledWith({
      worktreePath: '/path/to/worktree',
      base: 'origin/main'
    })
    expect(result.current.commits).toHaveLength(2)
    expect(result.current.error).toBeNull()
  })

  it('should set error state when getCommits fails', async () => {
    const task: SprintTask = {
      id: 'task-2',
      worktree_path: '/path/to/worktree'
    } as SprintTask

    useSprintTasks.setState({ tasks: [task] })

    mockGetCommits.mockRejectedValue(new Error('Git command failed'))

    const { result } = renderHook(() => useReviewCommits('task-2'))

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    expect(result.current.commits).toEqual([])
    expect(result.current.error).toBe('Git command failed')
  })

  it('should return empty commits when no worktree_path', async () => {
    const task: SprintTask = {
      id: 'task-3',
      worktree_path: null
    } as SprintTask

    useSprintTasks.setState({ tasks: [task] })

    const { result } = renderHook(() => useReviewCommits('task-3'))

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    expect(mockGetCommits).not.toHaveBeenCalled()
    expect(result.current.commits).toEqual([])
  })

  it('should cancel mid-flight requests when taskId changes', async () => {
    const task1: SprintTask = {
      id: 'task-1',
      worktree_path: '/path/1'
    } as SprintTask

    const task2: SprintTask = {
      id: 'task-2',
      worktree_path: '/path/2'
    } as SprintTask

    useSprintTasks.setState({ tasks: [task1, task2] })

    // First request resolves slowly
    mockGetCommits.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                commits: [{ hash: 'old123', message: 'old commit', author: 'Ryan', date: '2026-04-10' }]
              }),
            100
          )
        )
    )

    const { result, rerender } = renderHook(({ taskId }) => useReviewCommits(taskId), {
      initialProps: { taskId: 'task-1' }
    })

    // Change taskId before first request completes
    rerender({ taskId: 'task-2' })

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    // Should not have set commits from the cancelled request
    expect(result.current.commits).not.toContainEqual(
      expect.objectContaining({ hash: 'old123' })
    )
  })

  it('should handle non-Error exceptions', async () => {
    const task: SprintTask = {
      id: 'task-4',
      worktree_path: '/path/to/worktree'
    } as SprintTask

    useSprintTasks.setState({ tasks: [task] })

    mockGetCommits.mockRejectedValue('String error')

    const { result } = renderHook(() => useReviewCommits('task-4'))

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    expect(result.current.commits).toEqual([])
    expect(result.current.error).toBe('Failed to load commits')
  })
})
