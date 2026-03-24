/**
 * ConnectionsSection — auth status, agent manager settings, and GitHub credential tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const mockAuthStatus = vi.fn().mockResolvedValue({
  cliFound: true,
  tokenFound: true,
  tokenExpired: false,
})

beforeEach(() => {
  vi.mocked(window.api.settings.get).mockResolvedValue(null)
  ;(window.api as unknown as Record<string, unknown>).authStatus = mockAuthStatus
})

import { ConnectionsSection } from '../ConnectionsSection'

describe('ConnectionsSection', () => {
  it('renders auth status section with Claude CLI Auth label', async () => {
    render(<ConnectionsSection />)
    expect(screen.getByText('Claude CLI Auth')).toBeInTheDocument()
  })

  it('shows auth badge after loading', async () => {
    render(<ConnectionsSection />)
    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument()
    })
  })

  it('renders agent manager settings fields', async () => {
    render(<ConnectionsSection />)
    expect(screen.getByText('Agent Manager')).toBeInTheDocument()
    expect(screen.getByText('Max Concurrent Agents')).toBeInTheDocument()
    expect(screen.getByText('Worktree Base Path')).toBeInTheDocument()
    expect(screen.getByText('Max Runtime (minutes)')).toBeInTheDocument()
  })

  it('renders GitHub credential form', async () => {
    render(<ConnectionsSection />)
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('Personal Access Token')).toBeInTheDocument()
  })

  it('renders Refresh button for auth status', async () => {
    render(<ConnectionsSection />)
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
  })
})
