import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const { mockSetDiffFiles, mockSetLoading, mockSetSelectedDiffFile } = vi.hoisted(() => ({
  mockSetDiffFiles: vi.fn(),
  mockSetLoading: vi.fn(),
  mockSetSelectedDiffFile: vi.fn()
}))

vi.mock('../../../stores/codeReview', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    selectedTaskId: 't1',
    diffFiles: [],
    loading: {},
    selectedDiffFile: null,
    setDiffFiles: mockSetDiffFiles,
    setLoading: mockSetLoading,
    setSelectedDiffFile: mockSetSelectedDiffFile
  }))
  return { useCodeReviewStore: store }
})

const { sprintState } = vi.hoisted(() => ({
  sprintState: {
    tasks: [] as Array<Record<string, unknown>>,
    loading: false,
    loadData: vi.fn()
  }
}))

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(sprintState))
}))

import { ChangesTab } from '../ChangesTab'
import { useCodeReviewStore } from '../../../stores/codeReview'

describe('ChangesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sprintState.tasks = [
      {
        id: 't1',
        title: 'Task',
        repo: 'fleet',
        status: 'review',
        worktree_path: '/tmp/wt',
        updated_at: '2026-04-01'
      }
    ]
    useCodeReviewStore.setState({
      selectedTaskId: 't1',
      diffFiles: [],
      loading: {},
      selectedDiffFile: null,
      setDiffFiles: mockSetDiffFiles,
      setLoading: mockSetLoading,
      setSelectedDiffFile: mockSetSelectedDiffFile
    })
  })

  it('shows loading state', () => {
    useCodeReviewStore.setState({ loading: { diff: true } })
    const { container } = render(<ChangesTab />)
    expect(container.querySelectorAll('.fleet-skeleton').length).toBeGreaterThan(0)
  })

  it('shows empty state when no files', () => {
    useCodeReviewStore.setState({ diffFiles: [], loading: {} })
    render(<ChangesTab />)
    expect(screen.getByText('No changes found in this branch.')).toBeInTheDocument()
  })

  it('calls getDiff on mount when task has worktree_path', async () => {
    render(<ChangesTab />)
    await waitFor(() => {
      expect(window.api.review.getDiff).toHaveBeenCalledWith({
        worktreePath: '/tmp/wt',
        base: 'origin/main'
      })
    })
  })

  describe('snapshot fallback', () => {
    beforeEach(() => {
      mockSetDiffFiles.mockImplementation((files: unknown) => {
        useCodeReviewStore.setState({ diffFiles: files as never })
      })
      mockSetLoading.mockImplementation(() => {})
      mockSetSelectedDiffFile.mockImplementation((path: unknown) => {
        useCodeReviewStore.setState({ selectedDiffFile: path as never })
      })
    })

    it('falls back to snapshot when worktree_path is null', async () => {
      const snapshot = {
        capturedAt: '2026-04-05T12:00:00.000Z',
        totals: { additions: 12, deletions: 4, files: 2 },
        files: [
          {
            path: 'src/foo.ts',
            status: 'M',
            additions: 10,
            deletions: 2,
            patch: 'diff --git a/src/foo.ts b/src/foo.ts\n+added foo'
          },
          {
            path: 'src/bar.ts',
            status: 'A',
            additions: 2,
            deletions: 2,
            patch: 'diff --git a/src/bar.ts b/src/bar.ts\n+added bar'
          }
        ]
      }
      sprintState.tasks = [
        {
          id: 't1',
          title: 'Task',
          repo: 'fleet',
          status: 'done',
          worktree_path: null,
          review_diff_snapshot: JSON.stringify(snapshot),
          updated_at: '2026-04-05'
        }
      ]
      useCodeReviewStore.setState({ selectedTaskId: 't1', diffFiles: [], loading: {} })

      render(<ChangesTab />)

      const banner = await screen.findByTestId('cr-changes-snapshot-banner')
      expect(banner).toBeInTheDocument()
      expect(banner.textContent).toContain('Worktree no longer available')
      expect(window.api.review.getDiff).not.toHaveBeenCalled()
    })

    it('shows truncated banner when snapshot has truncated:true', async () => {
      const snapshot = {
        capturedAt: '2026-04-05T12:00:00.000Z',
        totals: { additions: 5000, deletions: 100, files: 1 },
        truncated: true,
        files: [
          {
            path: 'src/big.ts',
            status: 'M',
            additions: 5000,
            deletions: 100
          }
        ]
      }
      sprintState.tasks = [
        {
          id: 't1',
          title: 'Task',
          repo: 'fleet',
          status: 'done',
          worktree_path: null,
          review_diff_snapshot: JSON.stringify(snapshot),
          updated_at: '2026-04-05'
        }
      ]
      useCodeReviewStore.setState({ selectedTaskId: 't1', diffFiles: [], loading: {} })

      render(<ChangesTab />)

      const banner = await screen.findByTestId('cr-changes-snapshot-banner')
      expect(banner.textContent).toMatch(/file stats only|too large/i)
    })
  })
})
