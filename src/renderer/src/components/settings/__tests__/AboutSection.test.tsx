import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AboutSection } from '../AboutSection'

describe('AboutSection', () => {
  it('renders About heading', () => {
    render(<AboutSection />)
    expect(screen.getByText('About')).toBeInTheDocument()
  })

  it('displays app version', () => {
    render(<AboutSection />)
    expect(screen.getByText('Version')).toBeInTheDocument()
    expect(screen.getByText('0.0.0-test')).toBeInTheDocument()
  })

  it('displays log path', () => {
    render(<AboutSection />)
    expect(screen.getByText('Log Path')).toBeInTheDocument()
    expect(screen.getByText('~/.fleet/fleet.log')).toBeInTheDocument()
  })

  it('opens GitHub on click', () => {
    render(<AboutSection />)
    fireEvent.click(screen.getByText('GitHub'))
    expect(window.api.window.openExternal).toHaveBeenCalledWith(
      'https://github.com/RyanJBirkeland/FLEET/releases'
    )
  })

  it('dispatches show-shortcuts event on click', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    render(<AboutSection />)
    fireEvent.click(screen.getByText('Keyboard Shortcuts'))
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fleet:show-shortcuts' })
    )
    dispatchSpy.mockRestore()
  })

  it('renders Check for Updates button', () => {
    render(<AboutSection />)
    expect(screen.getByRole('button', { name: 'Check for Updates' })).toBeInTheDocument()
  })

  it('calls checkForUpdates when the button is clicked', () => {
    render(<AboutSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Check for Updates' }))
    expect(window.api.updates.checkForUpdates).toHaveBeenCalled()
  })

  describe('update status subscription', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('shows status text when up-to-date', () => {
      let capturedCb: ((p: { status: string; version?: string; percent?: number; error?: string }) => void) | undefined
      vi.mocked(window.api.updates.onStatus).mockImplementation((cb) => {
        capturedCb = cb as typeof capturedCb
        return () => {}
      })
      render(<AboutSection />)
      act(() => { capturedCb!({ status: 'up-to-date' }) })
      expect(screen.getByText("You're up to date.")).toBeInTheDocument()
    })

    it('shows error status text with error class', () => {
      let capturedCb: ((p: { status: string; error?: string }) => void) | undefined
      vi.mocked(window.api.updates.onStatus).mockImplementation((cb) => {
        capturedCb = cb as typeof capturedCb
        return () => {}
      })
      render(<AboutSection />)
      act(() => { capturedCb!({ status: 'error', error: 'network failure' }) })
      const statusEl = screen.getByText(/Update check failed: network failure/)
      expect(statusEl).toBeInTheDocument()
      expect(statusEl.className).toContain('settings-about__update-status--error')
    })

    it('calls install() when button clicked in ready state', async () => {
      let capturedCb: ((p: { status: string; version?: string }) => void) | undefined
      vi.mocked(window.api.updates.onStatus).mockImplementation((cb) => {
        capturedCb = cb as typeof capturedCb
        return () => {}
      })
      render(<AboutSection />)
      act(() => { capturedCb!({ status: 'ready', version: '1.1.0' }) })
      await userEvent.click(screen.getByRole('button', { name: /restart to update/i }))
      expect(window.api.updates.install).toHaveBeenCalledOnce()
      expect(window.api.updates.checkForUpdates).not.toHaveBeenCalled()
    })

    it('disables button during downloading state', () => {
      let capturedCb: ((p: { status: string; percent?: number }) => void) | undefined
      vi.mocked(window.api.updates.onStatus).mockImplementation((cb) => {
        capturedCb = cb as typeof capturedCb
        return () => {}
      })
      render(<AboutSection />)
      act(() => { capturedCb!({ status: 'downloading', percent: 50 }) })
      expect(screen.getByRole('button', { name: /downloading/i })).toBeDisabled()
    })
  })
})
