import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockSetDiffFiles, mockSetLoading } = vi.hoisted(() => ({
  mockSetDiffFiles: vi.fn(),
  mockSetLoading: vi.fn()
}))

vi.mock('../../../stores/codeReview', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    selectedTaskId: 't1',
    diffFiles: [],
    loading: {},
    setDiffFiles: mockSetDiffFiles,
    setLoading: mockSetLoading
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
        repo: 'bde',
        status: 'review',
        worktree_path: '/tmp/wt',
        updated_at: '2026-04-01'
      }
    ]
    useCodeReviewStore.setState({
      selectedTaskId: 't1',
      diffFiles: [],
      loading: {},
      setDiffFiles: mockSetDiffFiles,
      setLoading: mockSetLoading
    })
  })

  it('shows loading state', () => {
    useCodeReviewStore.setState({ loading: { diff: true } })
    const { container } = render(<ChangesTab />)
    expect(container.querySelectorAll('.bde-skeleton').length).toBeGreaterThan(0)
  })

  it('shows empty state when no files', () => {
    useCodeReviewStore.setState({ diffFiles: [], loading: {} })
    render(<ChangesTab />)
    expect(screen.getByText('No changes found in this branch.')).toBeInTheDocument()
  })

  it('shows file list after loading', () => {
    useCodeReviewStore.setState({
      diffFiles: [
        { path: 'src/index.ts', status: 'M', additions: 10, deletions: 2, patch: '' },
        { path: 'src/new.ts', status: 'A', additions: 50, deletions: 0, patch: '' },
        { path: 'src/old.ts', status: 'D', additions: 0, deletions: 30, patch: '' }
      ],
      loading: {}
    })
    render(<ChangesTab />)
    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
    expect(screen.getByText('src/new.ts')).toBeInTheDocument()
    expect(screen.getByText('src/old.ts')).toBeInTheDocument()
  })

  it('shows addition/deletion stats per file', () => {
    useCodeReviewStore.setState({
      diffFiles: [{ path: 'src/index.ts', status: 'M', additions: 10, deletions: 2, patch: '' }],
      loading: {}
    })
    render(<ChangesTab />)
    expect(screen.getByText('+10 -2')).toBeInTheDocument()
  })

  it('clicking file selects it', () => {
    useCodeReviewStore.setState({
      diffFiles: [
        { path: 'src/a.ts', status: 'M', additions: 1, deletions: 0, patch: '' },
        { path: 'src/b.ts', status: 'M', additions: 2, deletions: 1, patch: '' }
      ],
      loading: {}
    })
    render(<ChangesTab />)
    const btn = screen.getByText('src/b.ts').closest('button')
    fireEvent.click(btn!)
    expect(btn?.className).toContain('cr-changes__file')
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

  it('renders status icons for added/deleted/modified files', () => {
    useCodeReviewStore.setState({
      diffFiles: [
        { path: 'added.ts', status: 'A', additions: 1, deletions: 0, patch: '' },
        { path: 'deleted.ts', status: 'D', additions: 0, deletions: 1, patch: '' },
        { path: 'modified.ts', status: 'M', additions: 1, deletions: 1, patch: '' }
      ],
      loading: {}
    })
    const { container } = render(<ChangesTab />)
    expect(container.querySelector('.cr-file-added')).toBeInTheDocument()
    expect(container.querySelector('.cr-file-deleted')).toBeInTheDocument()
    expect(container.querySelector('.cr-file-modified')).toBeInTheDocument()
  })

  describe('snapshot fallback', () => {
    // Make setDiffFiles actually populate the store so the rendered file list
    // reflects the snapshot we install via applySnapshot().
    beforeEach(() => {
      mockSetDiffFiles.mockImplementation((files: unknown) => {
        useCodeReviewStore.setState({ diffFiles: files as never })
      })
      mockSetLoading.mockImplementation(() => {})
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
          repo: 'bde',
          status: 'done',
          worktree_path: null,
          review_diff_snapshot: JSON.stringify(snapshot),
          updated_at: '2026-04-05'
        }
      ]
      useCodeReviewStore.setState({ selectedTaskId: 't1', diffFiles: [], loading: {} })

      render(<ChangesTab />)

      // Snapshot fallback banner is visible
      const banner = await screen.findByTestId('cr-changes-snapshot-banner')
      expect(banner).toBeInTheDocument()
      expect(banner.textContent).toContain('Worktree no longer available')

      // Files from the snapshot render in the sidebar
      expect(screen.getByText('src/foo.ts')).toBeInTheDocument()
      expect(screen.getByText('src/bar.ts')).toBeInTheDocument()

      // Live API was NOT called — there's no worktree to query
      expect(window.api.review.getDiff).not.toHaveBeenCalled()

      // Clicking a file selects it (and the underlying patch comes from snapshot)
      const barRow = screen.getByText('src/bar.ts').closest('button')
      fireEvent.click(barRow!)
      expect(barRow?.className).toContain('cr-changes__file--selected')
    })

    it('shows truncated banner when snapshot has truncated:true and patches absent', async () => {
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
            // no patch — was dropped because it exceeded the size budget
          }
        ]
      }
      sprintState.tasks = [
        {
          id: 't1',
          title: 'Task',
          repo: 'bde',
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

      // File row still rendered with stats
      expect(screen.getByText('src/big.ts')).toBeInTheDocument()
      expect(screen.getByText('+5000 -100')).toBeInTheDocument()
    })
  })
})
