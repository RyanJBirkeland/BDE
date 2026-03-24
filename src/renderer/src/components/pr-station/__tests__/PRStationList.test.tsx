import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../lib/github-api', () => ({}))
vi.mock('../../../lib/render-markdown', () => ({ renderMarkdown: (s: string) => s }))

import { PRStationList } from '../PRStationList'

const mockPr = {
  number: 42,
  title: 'Add feature X',
  html_url: 'https://github.com/o/r/pull/42',
  state: 'open',
  draft: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  head: { ref: 'feat/x', sha: 'abc123' },
  base: { ref: 'main' },
  user: { login: 'alice' },
  merged: false,
  merged_at: null,
  repo: 'BDE',
}

describe('PRStationList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window.api as any).getPrList = vi.fn().mockResolvedValue({
      prs: [mockPr],
      checks: { 'BDE-42': { total: 1, passed: 1, failed: 0, pending: 0, status: 'pass' } },
    })
    ;(window.api as any).onPrListUpdated = vi.fn().mockReturnValue(() => {})
    ;(window.api as any).refreshPrList = vi.fn().mockResolvedValue({ prs: [], checks: {} })
  })

  it('renders PR list after loading', async () => {
    render(<PRStationList selectedPr={null} onSelectPr={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('#42')).toBeInTheDocument())
    expect(screen.getByText('Add feature X')).toBeInTheDocument()
  })

  it('shows empty state when no PRs', async () => {
    ;(window.api as any).getPrList = vi.fn().mockResolvedValue({ prs: [], checks: {} })
    render(<PRStationList selectedPr={null} onSelectPr={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/no open/i)).toBeInTheDocument())
  })

  it('calls onSelectPr when row clicked', async () => {
    const onSelect = vi.fn()
    render(<PRStationList selectedPr={null} onSelectPr={onSelect} />)
    await waitFor(() => expect(screen.getByText('#42')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Add feature X'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ number: 42 }))
  })

  it('subscribes to PR list updates on mount', () => {
    render(<PRStationList selectedPr={null} onSelectPr={vi.fn()} />)
    expect((window.api as any).onPrListUpdated).toHaveBeenCalled()
  })
})
