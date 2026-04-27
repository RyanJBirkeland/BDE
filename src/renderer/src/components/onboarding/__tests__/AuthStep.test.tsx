import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthStep } from '../steps/AuthStep'

const stepProps = {
  onNext: vi.fn(),
  onBack: vi.fn(),
  onComplete: vi.fn(),
  isFirst: false,
  isLast: false
}

function mockAuth(status: { cliFound: boolean; tokenFound: boolean; tokenExpired: boolean }): void {
  const api = (globalThis as unknown as { api: Record<string, unknown> }).api
  const auth = api.auth as { status: ReturnType<typeof vi.fn> }
  auth.status = vi.fn().mockResolvedValue(status)
}

describe('AuthStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true
    })
  })

  it('enables Next and hides help when all checks pass', async () => {
    mockAuth({ cliFound: true, tokenFound: true, tokenExpired: false })
    render(<AuthStep {...stepProps} />)

    const nextBtn = await screen.findByRole('button', { name: /next/i })
    await waitFor(() => expect(nextBtn).not.toBeDisabled())
    expect(screen.queryByText(/install claude code cli/i)).toBeNull()
  })

  it('surfaces install command with copy button when CLI is missing', async () => {
    mockAuth({ cliFound: false, tokenFound: false, tokenExpired: false })
    render(<AuthStep {...stepProps} />)

    const copyButton = await screen.findByRole('button', { name: /copy install command/i })
    expect(copyButton).toBeInTheDocument()
    expect(screen.getByText(/claude\.ai\/install\.sh/i)).toBeInTheDocument()
  })

  it('surfaces claude login command when CLI is present but token is missing', async () => {
    mockAuth({ cliFound: true, tokenFound: false, tokenExpired: false })
    render(<AuthStep {...stepProps} />)

    const copyButton = await screen.findByRole('button', { name: /copy login command/i })
    expect(copyButton).toBeInTheDocument()
  })

  it('writes the command to the clipboard when the copy button is clicked', async () => {
    mockAuth({ cliFound: true, tokenFound: false, tokenExpired: false })
    const writeText = vi.fn().mockResolvedValue(undefined)
    // Install clipboard mock AFTER userEvent.setup (which overrides clipboard
    // by default) so the component's copyToClipboard hits our spy.
    const user = userEvent.setup()
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })
    render(<AuthStep {...stepProps} />)

    const copyButton = await screen.findByRole('button', { name: /copy login command/i })
    await user.click(copyButton)

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('claude login')
    })
  })

  it('shows a timeout fallback alert when auth.status exceeds 10s', async () => {
    vi.useFakeTimers()
    const api = (globalThis as unknown as { api: Record<string, unknown> }).api
    const auth = api.auth as { status: ReturnType<typeof vi.fn> }
    // Never-resolving promise to force the timeout branch
    auth.status = vi.fn().mockReturnValue(new Promise(() => {}))

    render(<AuthStep {...stepProps} />)

    vi.advanceTimersByTime(11_000)
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/timed out/i)
    })

    // Verify diagnostic snippets and copy buttons are rendered
    const authStatusButton = screen.getByRole('button', { name: /copy auth status command/i })
    const quitRelaunchButton = screen.getByRole('button', {
      name: /copy quit and relaunch instruction/i
    })
    expect(authStatusButton).toBeInTheDocument()
    expect(quitRelaunchButton).toBeInTheDocument()
    expect(screen.getByText('claude auth status')).toBeInTheDocument()
    expect(screen.getByText('⌘Q then relaunch')).toBeInTheDocument()

    vi.useRealTimers()
  })
})
