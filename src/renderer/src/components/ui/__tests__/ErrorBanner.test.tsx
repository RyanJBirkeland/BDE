import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBanner } from '../ErrorBanner'

describe('ErrorBanner', () => {
  it('renders message when provided', () => {
    render(<ErrorBanner message="Something went wrong" />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('returns null when message is null', () => {
    const { container } = render(<ErrorBanner message={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('applies custom className', () => {
    const { container } = render(<ErrorBanner message="Error" className="custom" />)
    expect(container.firstChild).toHaveClass('bde-error-banner')
    expect(container.firstChild).toHaveClass('custom')
  })
})
