import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
})
