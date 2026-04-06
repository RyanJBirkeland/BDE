import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const { mockSetCommits, mockSetLoading } = vi.hoisted(() => ({
  mockSetCommits: vi.fn(),
  mockSetLoading: vi.fn()
}))

vi.mock('../../../stores/codeReview', () => {
  const { create } = require('zustand')
  const store = create(() => ({
    selectedTaskId: 't1',
    commits: [],
    loading: {},
    setCommits: mockSetCommits,
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

import { CommitsTab } from '../CommitsTab'
import { useCodeReviewStore } from '../../../stores/codeReview'

describe('CommitsTab', () => {
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
      commits: [],
      loading: {},
      setCommits: mockSetCommits,
      setLoading: mockSetLoading
    })
  })

  it('shows loading state', () => {
    useCodeReviewStore.setState({ loading: { commits: true } })
    const { container } = render(<CommitsTab />)
    expect(container.querySelectorAll('.bde-skeleton').length).toBeGreaterThan(0)
  })

  it('shows empty state when no commits', () => {
    useCodeReviewStore.setState({ commits: [], loading: {} })
    render(<CommitsTab />)
    expect(screen.getByText('No commits found on this branch.')).toBeInTheDocument()
  })

  it('renders commit list after loading', () => {
    useCodeReviewStore.setState({
      commits: [
        {
          hash: 'abc123456',
          message: 'feat: add new feature',
          author: 'Test Author',
          date: '2026-04-01T10:00:00Z'
        },
        {
          hash: 'def789012',
          message: 'fix: resolve bug',
          author: 'Another Dev',
          date: '2026-04-01T11:00:00Z'
        }
      ],
      loading: {}
    })
    render(<CommitsTab />)
    expect(screen.getByText('feat: add new feature')).toBeInTheDocument()
    expect(screen.getByText('fix: resolve bug')).toBeInTheDocument()
  })

  it('shows hash, message, author, date', () => {
    useCodeReviewStore.setState({
      commits: [
        {
          hash: 'abc123456789',
          message: 'chore: update deps',
          author: 'Jane Doe',
          date: '2026-04-01T12:00:00Z'
        }
      ],
      loading: {}
    })
    render(<CommitsTab />)
    expect(screen.getByText('chore: update deps')).toBeInTheDocument()
    expect(screen.getByText(/abc1234/)).toBeInTheDocument() // short hash
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument()
    expect(screen.getByText(/4\/1\/2026/)).toBeInTheDocument()
  })

  it('calls getCommits on mount when task has worktree_path', async () => {
    render(<CommitsTab />)
    await waitFor(() => {
      expect(window.api.review.getCommits).toHaveBeenCalledWith({
        worktreePath: '/tmp/wt',
        base: 'origin/main'
      })
    })
  })
})
