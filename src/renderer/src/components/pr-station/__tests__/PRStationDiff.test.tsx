import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import type { LineRange } from '../../diff/DiffViewer'
import type { PendingComment } from '../../../stores/pendingReview'

const mockGetPRDiff = vi.fn()
const mockCachedGetReviewComments = vi.fn()

vi.mock('../../../lib/github-api', () => ({
  getPRDiff: (...args: unknown[]) => mockGetPRDiff(...args)
}))

vi.mock('../../../lib/github-cache', () => ({
  cachedGetReviewComments: (...args: unknown[]) => mockCachedGetReviewComments(...args)
}))

vi.mock('../../../lib/diff-parser', () => ({
  parseDiffChunked: vi.fn().mockResolvedValue(undefined)
}))

// Mutable pending state for tests that need to control it
const mockAddComment = vi.fn()
const mockRemoveComment = vi.fn()
let pendingCommentsRecord: Record<string, PendingComment[]> = {}

vi.mock('../../../stores/pendingReview', () => ({
  usePendingReviewStore: (selector: (s: unknown) => unknown) =>
    selector({
      pendingComments: pendingCommentsRecord,
      addComment: mockAddComment,
      removeComment: mockRemoveComment
    })
}))

vi.mock('../../../stores/panelLayout', () => ({
  usePanelLayoutStore: (selector: (s: unknown) => unknown) => selector({ theme: 'dark' })
}))

// Capture the props passed to DiffViewer so we can assert on them
let capturedDiffViewerProps: Record<string, unknown> = {}

vi.mock('../../diff/DiffViewer', () => ({
  DiffViewer: (props: Record<string, unknown>) => {
    capturedDiffViewerProps = props
    const files = props.files as unknown[]
    return <div data-testid="diff-viewer">{files.length} files</div>
  }
}))

vi.mock('../../diff/DiffSizeWarning', () => ({
  DiffSizeWarning: () => <div data-testid="diff-size-warning" />
}))

import { PRStationDiff } from '../PRStationDiff'
import type { OpenPr } from '../../../../../shared/types'

const mockPr: OpenPr = {
  number: 42,
  title: 'My Feature PR',
  html_url: 'https://github.com/o/r/pull/42',
  state: 'open',
  draft: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  head: { ref: 'feat/my-feature', sha: 'abc123' },
  base: { ref: 'main' },
  user: { login: 'alice' },
  merged: false,
  merged_at: null,
  repo: 'BDE'
}

describe('PRStationDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pendingCommentsRecord = {}
    capturedDiffViewerProps = {}
    mockGetPRDiff.mockResolvedValue('diff --git a/foo.ts b/foo.ts\n')
    mockCachedGetReviewComments.mockResolvedValue([])
  })

  it('fetches the diff from GitHub API', async () => {
    render(<PRStationDiff pr={mockPr} />)
    await waitFor(() => expect(mockGetPRDiff).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 42))
  })

  it('renders DiffViewer after diff loads', async () => {
    render(<PRStationDiff pr={mockPr} />)
    await waitFor(() => expect(screen.getByTestId('diff-viewer')).toBeInTheDocument())
  })

  it('shows error banner on fetch failure', async () => {
    mockGetPRDiff.mockRejectedValue(new Error('network error'))
    render(<PRStationDiff pr={mockPr} />)
    await waitFor(() => expect(screen.getByText(/network error/i)).toBeInTheDocument())
  })

  it('fetches review comments in parallel with diff (using cache)', async () => {
    render(<PRStationDiff pr={mockPr} />)
    await waitFor(() =>
      expect(mockCachedGetReviewComments).toHaveBeenCalledWith('RyanJBirkeland', 'BDE', 42)
    )
  })

  it('passes pending comments from the store to DiffViewer', async () => {
    const prKey = 'BDE#42'
    const pending: PendingComment[] = [
      { id: 'p1', path: 'src/index.ts', line: 3, side: 'RIGHT', body: 'style issue' }
    ]
    pendingCommentsRecord[prKey] = pending

    render(<PRStationDiff pr={mockPr} />)
    await waitFor(() => expect(screen.getByTestId('diff-viewer')).toBeInTheDocument())

    expect(capturedDiffViewerProps.pendingComments).toEqual(pending)
  })

  it('calls addComment via onAddComment when DiffViewer triggers it', async () => {
    render(<PRStationDiff pr={mockPr} />)
    await waitFor(() => expect(screen.getByTestId('diff-viewer')).toBeInTheDocument())

    const onAddComment = capturedDiffViewerProps.onAddComment as (
      range: LineRange,
      body: string
    ) => void
    const range: LineRange = { file: 'src/index.ts', startLine: 5, endLine: 5, side: 'RIGHT' }

    act(() => {
      onAddComment(range, 'this needs a test')
    })

    expect(mockAddComment).toHaveBeenCalledWith(
      'BDE#42',
      expect.objectContaining({
        path: 'src/index.ts',
        line: 5,
        side: 'RIGHT',
        body: 'this needs a test'
      })
    )
  })

  it('calls removeComment via onRemovePendingComment when DiffViewer triggers it', async () => {
    render(<PRStationDiff pr={mockPr} />)
    await waitFor(() => expect(screen.getByTestId('diff-viewer')).toBeInTheDocument())

    const onRemove = capturedDiffViewerProps.onRemovePendingComment as (id: string) => void

    act(() => {
      onRemove('comment-id-123')
    })

    expect(mockRemoveComment).toHaveBeenCalledWith('BDE#42', 'comment-id-123')
  })

  it('passes empty pendingComments array to DiffViewer when none in store', async () => {
    render(<PRStationDiff pr={mockPr} />)
    await waitFor(() => expect(screen.getByTestId('diff-viewer')).toBeInTheDocument())

    const pending = capturedDiffViewerProps.pendingComments as PendingComment[]
    expect(pending).toEqual([])
  })
})
