import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// jsdom stubs
Element.prototype.scrollIntoView = vi.fn()

vi.mock('../../stores/pendingReview', () => ({
  usePendingReviewStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ pendingComments: {} })
  )
}))

vi.mock('../../lib/github-api', () => ({
  getPrMergeability: vi.fn().mockResolvedValue(null)
}))

vi.mock('../../components/pr-station/PRStationList', () => ({
  PRStationList: ({
    onSelectPr
  }: {
    onSelectPr: (pr: unknown) => void
    selectedPr: unknown
    removedKeys: Set<string>
  }) => (
    <div data-testid="pr-station-list">
      <button
        data-testid="select-pr-btn"
        onClick={() =>
          onSelectPr({
            number: 42,
            title: 'Test PR Title',
            html_url: 'https://github.com/owner/repo/pull/42',
            state: 'open',
            draft: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
            head: { ref: 'feat/test', sha: 'abc123' },
            base: { ref: 'main' },
            user: { login: 'testuser' },
            merged: false,
            merged_at: null,
            repo: 'BDE'
          })
        }
      >
        Select PR
      </button>
    </div>
  )
}))

vi.mock('../../components/pr-station/PRStationDetail', () => ({
  PRStationDetail: ({ pr }: { pr: { title: string } }) => (
    <div data-testid="pr-station-detail">{pr.title}</div>
  )
}))

vi.mock('../../components/pr-station/PRStationActions', () => ({
  PRStationActions: ({
    onRemovePr
  }: {
    pr: unknown
    mergeability: unknown
    onRemovePr: (pr: unknown) => void
  }) => (
    <div data-testid="pr-station-actions">
      <button
        data-testid="remove-pr-btn"
        onClick={() =>
          onRemovePr({
            number: 42,
            title: 'Test PR Title',
            repo: 'BDE'
          })
        }
      >
        Remove
      </button>
    </div>
  )
}))

vi.mock('../../components/pr-station/PRStationDiff', () => ({
  PRStationDiff: () => <div data-testid="pr-station-diff" />
}))

vi.mock('../../components/pr-station/ReviewSubmitDialog', () => ({
  ReviewSubmitDialog: ({
    onClose
  }: {
    pr: unknown
    prKey: string
    onClose: () => void
    onSubmitted: () => void
  }) => (
    <div data-testid="review-submit-dialog">
      <button data-testid="close-dialog-btn" onClick={onClose}>
        Close
      </button>
    </div>
  )
}))

import PRStationView from '../PRStationView'

describe('PRStationView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the PR Station heading', () => {
    render(<PRStationView />)
    expect(screen.getByText('PR Station')).toBeInTheDocument()
  })

  it('shows empty state when no PR is selected', () => {
    render(<PRStationView />)
    expect(screen.getByText(/Select a PR to view details/i)).toBeInTheDocument()
  })

  it('renders the PR list panel', () => {
    render(<PRStationView />)
    expect(screen.getByTestId('pr-station-list')).toBeInTheDocument()
  })

  it('shows PR detail when a PR is selected', async () => {
    render(<PRStationView />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-pr-btn'))
    })

    expect(screen.getByTestId('pr-station-detail')).toBeInTheDocument()
    expect(screen.getByText('Test PR Title')).toBeInTheDocument()
  })

  it('shows PR number and title in detail header', async () => {
    render(<PRStationView />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-pr-btn'))
    })

    expect(screen.getByText(/#42/)).toBeInTheDocument()
  })

  it('shows Info and Diff tabs when PR is selected', async () => {
    render(<PRStationView />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-pr-btn'))
    })

    expect(screen.getByText('Info')).toBeInTheDocument()
    expect(screen.getByText('Diff')).toBeInTheDocument()
  })

  it('starts on Info tab showing detail and actions', async () => {
    render(<PRStationView />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-pr-btn'))
    })

    expect(screen.getByTestId('pr-station-detail')).toBeInTheDocument()
    expect(screen.getByTestId('pr-station-actions')).toBeInTheDocument()
    expect(screen.queryByTestId('pr-station-diff')).not.toBeInTheDocument()
  })

  it('switches to Diff tab on click', async () => {
    render(<PRStationView />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-pr-btn'))
    })

    fireEvent.click(screen.getByText('Diff'))

    expect(screen.getByTestId('pr-station-diff')).toBeInTheDocument()
    expect(screen.queryByTestId('pr-station-detail')).not.toBeInTheDocument()
  })

  it('switches back to Info tab from Diff tab', async () => {
    render(<PRStationView />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-pr-btn'))
    })

    fireEvent.click(screen.getByText('Diff'))
    fireEvent.click(screen.getByText('Info'))

    expect(screen.getByTestId('pr-station-detail')).toBeInTheDocument()
    expect(screen.queryByTestId('pr-station-diff')).not.toBeInTheDocument()
  })

  it('clears selected PR and returns to empty state when removed', async () => {
    render(<PRStationView />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-pr-btn'))
    })

    expect(screen.getByTestId('pr-station-detail')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('remove-pr-btn'))
    })

    expect(screen.getByText(/Select a PR to view details/i)).toBeInTheDocument()
    expect(screen.queryByTestId('pr-station-detail')).not.toBeInTheDocument()
  })

  it('shows pending review banner when pendingComments exist', async () => {
    const { usePendingReviewStore } = await import('../../stores/pendingReview')
    vi.mocked(usePendingReviewStore).mockImplementation((selector) =>
      selector({
        pendingComments: { 'BDE#42': [{ id: 'c1', body: 'test', path: 'foo.ts', line: 1 }] }
      } as any)
    )

    render(<PRStationView />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-pr-btn'))
    })

    expect(screen.getByText(/pending comment/i)).toBeInTheDocument()
    expect(screen.getByText('Submit Review')).toBeInTheDocument()
  })

  it('opens review submit dialog when Submit Review is clicked', async () => {
    const { usePendingReviewStore } = await import('../../stores/pendingReview')
    vi.mocked(usePendingReviewStore).mockImplementation((selector) =>
      selector({
        pendingComments: { 'BDE#42': [{ id: 'c1', body: 'test', path: 'foo.ts', line: 1 }] }
      } as any)
    )

    render(<PRStationView />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-pr-btn'))
    })

    fireEvent.click(screen.getByText('Submit Review'))
    expect(screen.getByTestId('review-submit-dialog')).toBeInTheDocument()
  })

  it('closes review submit dialog when closed', async () => {
    const { usePendingReviewStore } = await import('../../stores/pendingReview')
    vi.mocked(usePendingReviewStore).mockImplementation((selector) =>
      selector({
        pendingComments: { 'BDE#42': [{ id: 'c1', body: 'test', path: 'foo.ts', line: 1 }] }
      } as any)
    )

    render(<PRStationView />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-pr-btn'))
    })

    fireEvent.click(screen.getByText('Submit Review'))
    fireEvent.click(screen.getByTestId('close-dialog-btn'))

    expect(screen.queryByTestId('review-submit-dialog')).not.toBeInTheDocument()
  })
})
