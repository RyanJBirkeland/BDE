import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OpenPr } from '../../../../../shared/types'

import { OpenPRsCard } from '../OpenPRsCard'

function makePr(overrides: Partial<OpenPr> = {}): OpenPr {
  return {
    number: 1,
    title: 'Test PR',
    html_url: 'https://github.com/test/repo/pull/1',
    state: 'open',
    draft: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    head: { ref: 'feat/test', sha: 'abc123' },
    base: { ref: 'main' },
    user: { login: 'testuser' },
    merged: false,
    merged_at: null,
    repo: 'test-repo',
    ...overrides
  }
}

describe('OpenPRsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders card title', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({ prs: [], checks: {} })
    render(<OpenPRsCard />)
    expect(screen.getByText('Open PRs')).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    // Never-resolving promise to keep loading state
    vi.mocked(window.api.getPrList).mockReturnValue(new Promise(() => {}))
    render(<OpenPRsCard />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows empty state when no PRs', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({ prs: [], checks: {} })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('No open pull requests')).toBeInTheDocument()
    })
  })

  it('renders PR titles after loading', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [makePr({ number: 42, title: 'Add auth module' })],
      checks: {}
    })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('Add auth module')).toBeInTheDocument()
    })
  })

  it('shows PR number', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [makePr({ number: 99 })],
      checks: {}
    })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('#99')).toBeInTheDocument()
    })
  })

  it('shows Draft badge for draft PRs', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [makePr({ draft: true })],
      checks: {}
    })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('Draft')).toBeInTheDocument()
    })
  })

  it('does not show Draft badge for non-draft PRs', async () => {
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [makePr({ draft: false })],
      checks: {}
    })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('Test PR')).toBeInTheDocument()
    })
    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
  })

  it('limits display to 5 PRs', async () => {
    const prs = Array.from({ length: 7 }, (_, i) => makePr({ number: i + 1, title: `PR ${i + 1}` }))
    vi.mocked(window.api.getPrList).mockResolvedValue({ prs, checks: {} })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('PR 5')).toBeInTheDocument()
    })
    expect(screen.queryByText('PR 6')).not.toBeInTheDocument()
  })

  it('calls openExternal when link button clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.getPrList).mockResolvedValue({
      prs: [makePr({ number: 7, html_url: 'https://github.com/test/repo/pull/7' })],
      checks: {}
    })
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('Test PR')).toBeInTheDocument()
    })
    await user.click(screen.getByLabelText('Open PR #7 in browser'))
    expect(window.api.openExternal).toHaveBeenCalledWith('https://github.com/test/repo/pull/7')
  })

  it('handles getPrList rejection gracefully', async () => {
    vi.mocked(window.api.getPrList).mockRejectedValue(new Error('network'))
    render(<OpenPRsCard />)
    await waitFor(() => {
      expect(screen.getByText('No open pull requests')).toBeInTheDocument()
    })
  })
})
