import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockCreateReview = vi.fn()
vi.mock('../../../lib/github-api', () => ({
  createReview: (...args: unknown[]) => mockCreateReview(...args),
}))

const mockClearPending = vi.fn()
const pendingCommentsMap = new Map<string, unknown[]>()

vi.mock('../../../stores/pendingReview', () => ({
  usePendingReviewStore: (selector: (s: unknown) => unknown) =>
    selector({
      pendingComments: pendingCommentsMap,
      clearPending: mockClearPending,
    }),
}))

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock('../../../stores/toasts', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

import { ReviewSubmitDialog } from '../ReviewSubmitDialog'
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
  repo: 'BDE',
}

const prKey = 'BDE#42'

function renderDialog(overrides?: { prKey?: string; onClose?: () => void; onSubmitted?: () => void }) {
  const onClose = overrides?.onClose ?? vi.fn()
  const onSubmitted = overrides?.onSubmitted ?? vi.fn()
  return {
    onClose,
    onSubmitted,
    ...render(
      <ReviewSubmitDialog
        pr={mockPr}
        prKey={overrides?.prKey ?? prKey}
        onClose={onClose}
        onSubmitted={onSubmitted}
      />
    ),
  }
}

describe('ReviewSubmitDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pendingCommentsMap.clear()
    mockCreateReview.mockResolvedValue(undefined)
  })

  it('renders all three review type options', () => {
    renderDialog()
    expect(screen.getByRole('radio', { name: /comment/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /request changes/i })).toBeInTheDocument()
  })

  it('defaults to COMMENT review type selected', () => {
    renderDialog()
    expect(screen.getByRole('radio', { name: /comment/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /approve/i })).not.toBeChecked()
  })

  it('calls onClose when Cancel button clicked', async () => {
    const { onClose } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not show pending comment count when no pending comments', () => {
    renderDialog()
    expect(screen.queryByText(/pending comment/i)).not.toBeInTheDocument()
  })

  it('shows pending comment count when there are pending comments', () => {
    pendingCommentsMap.set(prKey, [
      { id: '1', path: 'foo.ts', line: 1, side: 'RIGHT', body: 'nice' },
      { id: '2', path: 'bar.ts', line: 5, side: 'RIGHT', body: 'fix this' },
    ])
    renderDialog()
    expect(screen.getByText(/2 pending comments will be included/i)).toBeInTheDocument()
  })

  it('shows singular "comment" when exactly 1 pending comment', () => {
    pendingCommentsMap.set(prKey, [
      { id: '1', path: 'foo.ts', line: 1, side: 'RIGHT', body: 'nice' },
    ])
    renderDialog()
    expect(screen.getByText(/1 pending comment will be included/i)).toBeInTheDocument()
  })

  it('submits review and calls onSubmitted + onClose', async () => {
    const { onClose, onSubmitted } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }))
    await waitFor(() => expect(mockCreateReview).toHaveBeenCalledWith(
      'RyanJBirkeland', 'BDE', 42,
      expect.objectContaining({ event: 'COMMENT' })
    ))
    expect(mockToastSuccess).toHaveBeenCalledWith('Review submitted')
    expect(mockClearPending).toHaveBeenCalledWith(prKey)
    expect(onSubmitted).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('shows error toast when createReview throws', async () => {
    mockCreateReview.mockRejectedValue(new Error('API error'))
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }))
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('API error'))
  })

  it('can switch to APPROVE review type', async () => {
    renderDialog()
    await userEvent.click(screen.getByRole('radio', { name: /approve/i }))
    expect(screen.getByRole('radio', { name: /approve/i })).toBeChecked()
  })

  it('submits with APPROVE event when Approve radio is selected', async () => {
    const { onSubmitted } = renderDialog()
    await userEvent.click(screen.getByRole('radio', { name: /approve/i }))
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }))
    await waitFor(() =>
      expect(mockCreateReview).toHaveBeenCalledWith(
        'RyanJBirkeland', 'BDE', 42,
        expect.objectContaining({ event: 'APPROVE' })
      )
    )
    expect(onSubmitted).toHaveBeenCalled()
  })

  it('submits with REQUEST_CHANGES event and body when Request Changes is selected and body typed', async () => {
    renderDialog()
    await userEvent.click(screen.getByRole('radio', { name: /request changes/i }))
    await userEvent.type(screen.getByPlaceholderText(/leave an overall comment/i), 'Please fix the types')
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }))
    await waitFor(() =>
      expect(mockCreateReview).toHaveBeenCalledWith(
        'RyanJBirkeland', 'BDE', 42,
        expect.objectContaining({ event: 'REQUEST_CHANGES', body: 'Please fix the types' })
      )
    )
  })

  it('passes pending comments to createReview', async () => {
    pendingCommentsMap.set(prKey, [
      { id: 'c1', path: 'src/foo.ts', line: 10, side: 'RIGHT', body: 'nit: rename this' },
      { id: 'c2', path: 'src/bar.ts', line: 5, side: 'RIGHT', body: 'extract to helper' },
    ])
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }))
    await waitFor(() =>
      expect(mockCreateReview).toHaveBeenCalledWith(
        'RyanJBirkeland', 'BDE', 42,
        expect.objectContaining({
          comments: [
            expect.objectContaining({ path: 'src/foo.ts', line: 10, body: 'nit: rename this' }),
            expect.objectContaining({ path: 'src/bar.ts', line: 5, body: 'extract to helper' }),
          ],
        })
      )
    )
  })

  it('calls clearPending and onSubmitted after successful submit', async () => {
    const { onSubmitted } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }))
    await waitFor(() => expect(mockCreateReview).toHaveBeenCalled())
    expect(mockClearPending).toHaveBeenCalledWith(prKey)
    expect(onSubmitted).toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledWith('Review submitted')
  })

  it('shows error toast and does not call onSubmitted when createReview fails', async () => {
    mockCreateReview.mockRejectedValue(new Error('GitHub rate limit'))
    const { onSubmitted } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /submit review/i }))
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('GitHub rate limit'))
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(mockClearPending).not.toHaveBeenCalled()
  })
})
