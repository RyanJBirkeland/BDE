import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useReviewChanges } from '../useReviewChanges'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useSprintTasks } from '../../stores/sprintTasks'
import type { SprintTask } from '../../../../shared/types'

// Mock window.api
const mockGetDiff = vi.fn()
const mockGetFileDiff = vi.fn()

vi.stubGlobal('window', {
  api: {
    review: {
      getDiff: mockGetDiff,
      getFileDiff: mockGetFileDiff
    }
  }
})

describe('useReviewChanges', () => {
  beforeEach(() => {
    // Reset stores
    useCodeReviewStore.setState({
      diffFiles: [],
      loading: {},
      selectedDiffFile: null
    })
    useSprintTasks.setState({ tasks: [] })

    // Reset mocks
    mockGetDiff.mockReset()
    mockGetFileDiff.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty state when taskId is null', async () => {
    const { result } = renderHook(() => useReviewChanges(null))

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    expect(result.current.files).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.isSnapshot).toBe(false)
  })

  it('should load files from getDiff on success', async () => {
    const task: SprintTask = {
      id: 'task-1',
      worktree_path: '/path/to/worktree',
      review_diff_snapshot: null
    } as SprintTask

    useSprintTasks.setState({ tasks: [task] })

    const mockFiles = [
      { path: 'file1.ts', status: 'M', additions: 5, deletions: 2, patch: 'diff1' },
      { path: 'file2.ts', status: 'A', additions: 10, deletions: 0, patch: 'diff2' }
    ]

    mockGetDiff.mockResolvedValue({ files: mockFiles })
    mockGetFileDiff.mockResolvedValue({ diff: 'diff1' })

    const { result } = renderHook(() => useReviewChanges('task-1'))

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    expect(mockGetDiff).toHaveBeenCalledWith({
      worktreePath: '/path/to/worktree',
      base: 'origin/main'
    })
    expect(result.current.files).toHaveLength(2)
    expect(result.current.isSnapshot).toBe(false)
  })

  it('should fall back to snapshot when getDiff fails', async () => {
    const snapshot = {
      capturedAt: '2026-04-11T12:00:00Z',
      totals: { additions: 5, deletions: 2, files: 1 },
      files: [{ path: 'file1.ts', status: 'M', additions: 5, deletions: 2, patch: 'snapshot-diff' }],
      truncated: false
    }

    const task: SprintTask = {
      id: 'task-2',
      worktree_path: '/path/to/worktree',
      review_diff_snapshot: JSON.stringify(snapshot)
    } as SprintTask

    useSprintTasks.setState({ tasks: [task] })

    mockGetDiff.mockRejectedValue(new Error('Worktree not found'))

    const { result } = renderHook(() => useReviewChanges('task-2'))

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    expect(result.current.isSnapshot).toBe(true)
    expect(result.current.snapshotCapturedAt).toBe('2026-04-11T12:00:00Z')
    expect(result.current.snapshotTruncated).toBe(false)
    expect(result.current.files).toHaveLength(1)
    expect(result.current.fileDiff).toBe('snapshot-diff')
  })

  it('should use snapshot when no worktree_path exists', async () => {
    const snapshot = {
      capturedAt: '2026-04-11T12:00:00Z',
      totals: { additions: 10, deletions: 5, files: 2 },
      files: [
        { path: 'file1.ts', status: 'M', additions: 5, deletions: 2, patch: 'diff1' },
        { path: 'file2.ts', status: 'A', additions: 5, deletions: 3, patch: 'diff2' }
      ],
      truncated: true
    }

    const task: SprintTask = {
      id: 'task-3',
      worktree_path: null,
      review_diff_snapshot: JSON.stringify(snapshot)
    } as SprintTask

    useSprintTasks.setState({ tasks: [task] })

    const { result } = renderHook(() => useReviewChanges('task-3'))

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    expect(mockGetDiff).not.toHaveBeenCalled()
    expect(result.current.isSnapshot).toBe(true)
    expect(result.current.snapshotTruncated).toBe(true)
    expect(result.current.files).toHaveLength(2)
  })

  it('should return empty files when no worktree and no snapshot', async () => {
    const task: SprintTask = {
      id: 'task-4',
      worktree_path: null,
      review_diff_snapshot: null
    } as SprintTask

    useSprintTasks.setState({ tasks: [task] })

    const { result } = renderHook(() => useReviewChanges('task-4'))

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    expect(mockGetDiff).not.toHaveBeenCalled()
    expect(result.current.files).toEqual([])
    expect(result.current.isSnapshot).toBe(false)
  })

  it('should cancel mid-flight requests when taskId changes', async () => {
    const task1: SprintTask = {
      id: 'task-1',
      worktree_path: '/path/1',
      review_diff_snapshot: null
    } as SprintTask

    const task2: SprintTask = {
      id: 'task-2',
      worktree_path: '/path/2',
      review_diff_snapshot: null
    } as SprintTask

    useSprintTasks.setState({ tasks: [task1, task2] })

    // First request resolves slowly
    mockGetDiff.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ files: [{ path: 'old.ts', status: 'M', additions: 1, deletions: 0, patch: '' }] }), 100)
        )
    )

    const { result, rerender } = renderHook(({ taskId }) => useReviewChanges(taskId), {
      initialProps: { taskId: 'task-1' }
    })

    // Change taskId before first request completes
    rerender({ taskId: 'task-2' })

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    // Should not have set files from the cancelled request
    expect(result.current.files).not.toContainEqual(
      expect.objectContaining({ path: 'old.ts' })
    )
  })

  it('should load file diff when a file is selected', async () => {
    const task: SprintTask = {
      id: 'task-5',
      worktree_path: '/path/to/worktree',
      review_diff_snapshot: null
    } as SprintTask

    useSprintTasks.setState({ tasks: [task] })

    const mockFiles = [{ path: 'file1.ts', status: 'M', additions: 5, deletions: 2, patch: '' }]

    mockGetDiff.mockResolvedValue({ files: mockFiles })
    mockGetFileDiff.mockResolvedValue({ diff: 'file1-diff-content' })

    const { result } = renderHook(() => useReviewChanges('task-5'))

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    await act(async () => {
      await vi.waitFor(() => result.current.fileDiff === 'file1-diff-content')
    })

    expect(mockGetFileDiff).toHaveBeenCalledWith({
      worktreePath: '/path/to/worktree',
      filePath: 'file1.ts',
      base: 'origin/main'
    })
  })

  it('should read file diff from snapshot when using snapshot', async () => {
    const snapshot = {
      capturedAt: '2026-04-11T12:00:00Z',
      totals: { additions: 5, deletions: 2, files: 1 },
      files: [{ path: 'file1.ts', status: 'M', additions: 5, deletions: 2, patch: 'snapshot-patch' }],
      truncated: false
    }

    const task: SprintTask = {
      id: 'task-6',
      worktree_path: null,
      review_diff_snapshot: JSON.stringify(snapshot)
    } as SprintTask

    useSprintTasks.setState({ tasks: [task] })

    const { result } = renderHook(() => useReviewChanges('task-6'))

    await act(async () => {
      await vi.waitFor(() => result.current.loading === false)
    })

    expect(result.current.fileDiff).toBe('snapshot-patch')
    expect(mockGetFileDiff).not.toHaveBeenCalled()
  })
})
