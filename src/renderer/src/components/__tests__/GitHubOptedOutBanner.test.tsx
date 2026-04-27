import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GitHubOptedOutBanner } from '../GitHubOptedOutBanner'

function setOptedOut(value: boolean): void {
  const api = (globalThis as unknown as { api: Record<string, unknown> }).api
  const settings = api.settings as { get: ReturnType<typeof vi.fn> }
  settings.get = vi.fn().mockResolvedValue(value ? 'true' : 'false')
}

describe('GitHubOptedOutBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('renders nothing when githubOptedOut is false', async () => {
    setOptedOut(false)
    const { container } = render(<GitHubOptedOutBanner />)
    // Give the settings.get promise a tick to resolve
    await waitFor(() => {
      expect(container.textContent).toBe('')
    })
  })

  it('renders a status banner when githubOptedOut is true', async () => {
    setOptedOut(true)
    render(<GitHubOptedOutBanner />)

    const banner = await screen.findByRole('status')
    expect(banner.textContent).toMatch(/GitHub disabled/i)
    expect(banner.textContent).toMatch(/gh auth login/i)
  })

  it('disappears when the dismiss button is clicked and persists within the session', async () => {
    setOptedOut(true)
    const user = userEvent.setup()
    const { unmount } = render(<GitHubOptedOutBanner />)

    const dismissBtn = await screen.findByRole('button', { name: /dismiss/i })
    await user.click(dismissBtn)

    expect(screen.queryByRole('status')).toBeNull()
    expect(sessionStorage.getItem('fleet:github-opted-out-dismissed')).toBe('1')

    unmount()
    // Re-mount in the same session — banner should stay hidden.
    render(<GitHubOptedOutBanner />)
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull()
    })
  })

  it('re-appears in a new session if the setting is still on', async () => {
    setOptedOut(true)
    sessionStorage.clear()
    render(<GitHubOptedOutBanner />)

    const banner = await screen.findByRole('status')
    expect(banner).toBeInTheDocument()
  })
})
