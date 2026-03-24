import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Use the real constants so REPO_OPTIONS matches what the component imports
import { PRStationConflictBanner } from '../PRStationConflictBanner'

const mockPr = {
  number: 42,
  repo: 'BDE',
  html_url: '',
  title: '',
  state: 'open',
  draft: false,
  created_at: '',
  updated_at: '',
  head: { ref: 'feat/x', sha: '' },
  base: { ref: 'main' },
  user: { login: '' },
  merged: false,
  merged_at: null,
}

describe('PRStationConflictBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window.api as any).checkConflictFiles = vi.fn().mockResolvedValue({
      files: ['src/main.ts', 'README.md'],
      prNumber: 42,
      baseBranch: 'main',
      headBranch: 'feat/x',
    })
  })

  it('renders nothing when mergeableState is not dirty', () => {
    const { container } = render(<PRStationConflictBanner pr={mockPr} mergeableState="clean" />)
    expect(container.innerHTML).toBe('')
  })

  it('shows conflict files when mergeableState is dirty', async () => {
    render(<PRStationConflictBanner pr={mockPr} mergeableState="dirty" />)
    await waitFor(() => expect(screen.getByText('src/main.ts')).toBeInTheDocument())
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })
})
