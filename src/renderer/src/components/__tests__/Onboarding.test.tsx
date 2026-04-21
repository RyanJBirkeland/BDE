import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Onboarding } from '../Onboarding'

beforeEach(() => {
  vi.clearAllMocks()
  ;(window.api.auth as unknown as Record<string, unknown>).status = vi.fn().mockResolvedValue({
    cliFound: true,
    tokenFound: true,
    tokenExpired: false,
    expiresAt: '2026-12-31'
  })
  ;(window.api.git as unknown as Record<string, unknown>).checkInstalled = vi
    .fn()
    .mockResolvedValue(true)
})

describe('Onboarding', () => {
  it('renders the setup check screen', async () => {
    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)
    expect(screen.getByText('Setup Check')).toBeInTheDocument()
    expect(screen.getByText('Verifying Claude Code CLI and environment')).toBeInTheDocument()
  })

  it('shows required check rows', async () => {
    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)
    expect(screen.getByText('Claude Code CLI installed')).toBeInTheDocument()
    expect(screen.getByText('Claude login completed')).toBeInTheDocument()
    expect(screen.getByText('Token not expired')).toBeInTheDocument()
    expect(screen.getByText('Git available')).toBeInTheDocument()
  })

  it('shows optional check rows', async () => {
    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)
    expect(screen.getByText('Repositories configured')).toBeInTheDocument()
  })

  it('auto-advances when all required checks pass', async () => {
    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)
    await waitFor(() => {
      expect(onReady).toHaveBeenCalled()
    })
  })

  it('shows Continue button when all checks pass', async () => {
    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)
    await waitFor(() => {
      expect(screen.getByText('Continue')).toBeInTheDocument()
    })
  })

  it('does not auto-advance when CLI is not found', async () => {
    ;(window.api.auth as unknown as Record<string, unknown>).status = vi.fn().mockResolvedValue({
      cliFound: false,
      tokenFound: false,
      tokenExpired: false
    })

    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)

    await waitFor(() => {
      expect(screen.getByText('Continue without 3 required checks')).toBeInTheDocument()
    })
    expect(onReady).not.toHaveBeenCalled()
  })

  it('shows Re-check button when checks fail', async () => {
    ;(window.api.auth as unknown as Record<string, unknown>).status = vi.fn().mockResolvedValue({
      cliFound: false,
      tokenFound: false,
      tokenExpired: false
    })

    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)

    await waitFor(() => {
      expect(screen.getByText('Re-check')).toBeInTheDocument()
    })
  })

  it('shows help text for failed checks', async () => {
    ;(window.api.auth as unknown as Record<string, unknown>).status = vi.fn().mockResolvedValue({
      cliFound: false,
      tokenFound: false,
      tokenExpired: false
    })

    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)

    await waitFor(() => {
      // The instruction code block shows the helper text
      const codeEl = document.querySelector('.onboarding-instruction__code')
      expect(codeEl?.textContent).toContain('Install Claude Code CLI')
    })
  })

  it('enables bypass button and surfaces a risk callout when required checks fail', async () => {
    ;(window.api.auth as unknown as Record<string, unknown>).status = vi.fn().mockResolvedValue({
      cliFound: false,
      tokenFound: false,
      tokenExpired: false
    })

    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)

    const bypassButton = await waitFor(() => screen.getByText('Continue without 3 required checks'))
    expect(bypassButton.closest('button')).not.toBeDisabled()

    const callout = screen.getByRole('alert')
    expect(callout.textContent).toContain('Claude CLI')
    expect(callout.textContent).toContain('Claude login')
    expect(callout.textContent).toContain('valid token')
  })

  it('labels the bypass button with the single failing check when only one fails', async () => {
    ;(window.api.auth as unknown as Record<string, unknown>).status = vi.fn().mockResolvedValue({
      cliFound: true,
      tokenFound: true,
      tokenExpired: false
    })
    ;(window.api.git as unknown as Record<string, unknown>).checkInstalled = vi
      .fn()
      .mockResolvedValue(false)

    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)

    const bypassButton = await waitFor(() => screen.getByText('Continue without git'))
    expect(bypassButton.closest('button')).not.toBeDisabled()
  })

  it('enables Continue Anyway when only optional checks fail', async () => {
    ;(window.api.settings as unknown as Record<string, unknown>).get = vi
      .fn()
      .mockRejectedValue(new Error('no repos'))

    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)

    // All required checks pass — should auto-advance even when optional repos check fails
    await waitFor(() => {
      expect(onReady).toHaveBeenCalled()
    })
  })
})
