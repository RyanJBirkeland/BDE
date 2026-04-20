import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocalMcpServerSection } from '../LocalMcpServerSection'

type Api = {
  settings: {
    get: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
  }
  mcp: {
    getToken: ReturnType<typeof vi.fn>
    regenerateToken: ReturnType<typeof vi.fn>
  }
}

function getApi(): Api {
  return (globalThis as unknown as { api: Api }).api
}

const TEST_TOKEN = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

describe('LocalMcpServerSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const api = getApi()
    api.settings.get = vi.fn().mockImplementation((key: string) => {
      if (key === 'mcp.enabled') return Promise.resolve('false')
      if (key === 'mcp.port') return Promise.resolve('18792')
      return Promise.resolve(null)
    })
    api.settings.set = vi.fn().mockResolvedValue(undefined)
    api.mcp.getToken = vi.fn().mockResolvedValue(TEST_TOKEN)
    api.mcp.regenerateToken = vi.fn().mockResolvedValue('new-token-0123456789abcdef')
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true
    })
  })

  it('loads enabled/port/token on mount', async () => {
    render(<LocalMcpServerSection />)

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /enable mcp server/i })).not.toBeChecked()
    })
    expect((screen.getByLabelText(/port/i) as HTMLInputElement).value).toBe('18792')
  })

  it('renders the masked token until Reveal is clicked', async () => {
    render(<LocalMcpServerSection />)

    await waitFor(() => {
      // Masked form uses • bullets — the plain token should NOT be visible yet.
      expect(screen.queryByText(TEST_TOKEN)).toBeNull()
    })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reveal/i }))

    await waitFor(() => {
      expect(screen.getByText(TEST_TOKEN)).toBeInTheDocument()
    })
  })

  it('persists mcp.enabled toggle', async () => {
    const api = getApi()
    const user = userEvent.setup()
    render(<LocalMcpServerSection />)

    const checkbox = await screen.findByRole('checkbox', { name: /enable mcp server/i })
    await user.click(checkbox)

    await waitFor(() => {
      expect(api.settings.set).toHaveBeenCalledWith('mcp.enabled', 'true')
    })
  })

  it('writes the token to clipboard when Copy token is clicked', async () => {
    // Install clipboard mock AFTER userEvent.setup (which overrides clipboard by
    // default) so the component's navigator.clipboard.writeText hits our spy.
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })
    render(<LocalMcpServerSection />)

    const copyBtn = await screen.findByRole('button', { name: /copy token/i })
    await waitFor(() => expect(copyBtn).not.toBeDisabled())
    await user.click(copyBtn)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TEST_TOKEN))
  })

  it('copies a full Claude Code config snippet with the current port and token', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })
    render(<LocalMcpServerSection />)

    const copyConfig = await screen.findByRole('button', { name: /copy claude code config/i })
    await waitFor(() => expect(copyConfig).not.toBeDisabled())
    await user.click(copyConfig)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1)
      const snippet = writeText.mock.calls[0][0] as string
      expect(snippet).toMatch(/"url": "http:\/\/127\.0\.0\.1:18792\/mcp"/)
      expect(snippet).toMatch(new RegExp(`"Authorization": "Bearer ${TEST_TOKEN}"`))
    })
  })

  it('regenerates the token when the user confirms', async () => {
    const api = getApi()
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<LocalMcpServerSection />)

    await user.click(await screen.findByRole('button', { name: /regenerate/i }))

    await waitFor(() => {
      expect(api.mcp.regenerateToken).toHaveBeenCalledTimes(1)
    })
    confirmSpy.mockRestore()
  })

  it('does not regenerate when the user cancels the confirm', async () => {
    const api = getApi()
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<LocalMcpServerSection />)

    await user.click(await screen.findByRole('button', { name: /regenerate/i }))

    expect(api.mcp.regenerateToken).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('writes mcp.port to settings when the port is changed', async () => {
    const api = getApi()
    const user = userEvent.setup()
    render(<LocalMcpServerSection />)

    const portInput = (await screen.findByLabelText(/port/i)) as HTMLInputElement
    await user.clear(portInput)
    await user.type(portInput, '12345')

    await waitFor(() => {
      const calls = api.settings.set.mock.calls.filter((c: unknown[]) => c[0] === 'mcp.port')
      expect(calls.length).toBeGreaterThan(0)
      // Final value the user typed should have been persisted.
      const lastCall = calls[calls.length - 1]
      expect(lastCall?.[1]).toBe('12345')
    })
  })
})
