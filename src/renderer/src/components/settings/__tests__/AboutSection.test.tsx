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
    expect(screen.getByText('~/.bde/bde.log')).toBeInTheDocument()
  })

  it('opens GitHub on click', () => {
    render(<AboutSection />)
    fireEvent.click(screen.getByText('GitHub'))
    expect(window.api.openExternal).toHaveBeenCalledWith(
      'https://github.com/RyanJBirkeland/BDE'
    )
  })

  it('dispatches show-shortcuts event on click', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    render(<AboutSection />)
    fireEvent.click(screen.getByText('Keyboard Shortcuts'))
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'bde:show-shortcuts' })
    )
    dispatchSpy.mockRestore()
  })
})
