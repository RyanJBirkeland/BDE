/**
 * ConnectionsSection — auth status and GitHub credential tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../../stores/toasts', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

const mockAuthStatus = vi.fn().mockResolvedValue({
  cliFound: true,
  tokenFound: true,
  tokenExpired: false
})

beforeEach(() => {
  vi.mocked(window.api.settings.get).mockResolvedValue(null)
  vi.mocked(window.api.settings.set).mockResolvedValue(undefined)
  ;(window.api as unknown as Record<string, unknown>).authStatus = mockAuthStatus
  vi.clearAllMocks()
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

  it('renders GitHub credential form', async () => {
    render(<ConnectionsSection />)
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('Personal Access Token')).toBeInTheDocument()
  })

  it('renders Refresh button for auth status', async () => {
    render(<ConnectionsSection />)
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
  })

  it('GitHub Test button calls github.fetch(/user) and shows OK badge on success', async () => {
    vi.mocked(window.api.github.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      body: {},
      linkNext: null
    })
    // Pre-existing token so Test button is enabled
    vi.mocked(window.api.settings.get).mockImplementation((key: string) => {
      if (key === 'github.token') return Promise.resolve('ghp_existing')
      return Promise.resolve(null)
    })

    const user = userEvent.setup()
    render(<ConnectionsSection />)

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument()
    })

    const testButton = screen.getByRole('button', { name: /^test$/i })
    await user.click(testButton)

    await waitFor(() => {
      expect(window.api.github.fetch).toHaveBeenCalledWith('/user')
      expect(screen.getByText('OK')).toBeInTheDocument()
    })
  })

  it('GitHub Test button shows Failed badge on error response', async () => {
    vi.mocked(window.api.github.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      body: {},
      linkNext: null
    })
    vi.mocked(window.api.settings.get).mockImplementation((key: string) => {
      if (key === 'github.token') return Promise.resolve('ghp_bad_token')
      return Promise.resolve(null)
    })

    const user = userEvent.setup()
    render(<ConnectionsSection />)

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument()
    })

    const testButton = screen.getByRole('button', { name: /^test$/i })
    await user.click(testButton)

    await waitFor(() => {
      expect(window.api.github.fetch).toHaveBeenCalledWith('/user')
      expect(screen.getByText('Failed')).toBeInTheDocument()
    })
  })
})
