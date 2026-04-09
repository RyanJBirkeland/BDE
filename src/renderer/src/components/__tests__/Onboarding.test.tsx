import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Onboarding } from '../Onboarding'

beforeEach(() => {
  vi.clearAllMocks()
  ;(window.api as Record<string, unknown>).authStatus = vi.fn().mockResolvedValue({
    cliFound: true,
    tokenFound: true,
    tokenExpired: false,
    expiresAt: '2026-12-31'
  })
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
    expect(screen.getByText('Supabase connected')).toBeInTheDocument()
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
    ;(window.api as Record<string, unknown>).authStatus = vi.fn().mockResolvedValue({
      cliFound: false,
      tokenFound: false,
      tokenExpired: false
    })

    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)

    await waitFor(() => {
      expect(screen.getByText('Continue Anyway')).toBeInTheDocument()
    })
    expect(onReady).not.toHaveBeenCalled()
  })

  it('shows Check Again button when checks fail', async () => {
    ;(window.api as Record<string, unknown>).authStatus = vi.fn().mockResolvedValue({
      cliFound: false,
      tokenFound: false,
      tokenExpired: false
    })

    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)

    await waitFor(() => {
      expect(screen.getByText('Check Again')).toBeInTheDocument()
    })
  })

  it('shows help text for failed checks', async () => {
    ;(window.api as Record<string, unknown>).authStatus = vi.fn().mockResolvedValue({
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

  it('calls onReady when Continue Anyway is clicked', async () => {
    ;(window.api as Record<string, unknown>).authStatus = vi.fn().mockResolvedValue({
      cliFound: false,
      tokenFound: false,
      tokenExpired: false
    })

    const onReady = vi.fn()
    render(<Onboarding onReady={onReady} />)

    await waitFor(() => {
      expect(screen.getByText('Continue Anyway')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Continue Anyway'))
    expect(onReady).toHaveBeenCalled()
  })
})
