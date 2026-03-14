import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from '../Badge'

describe('Badge', () => {
  it('renders with correct text', () => {
    render(<Badge>Active</Badge>)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('applies default variant class', () => {
    const { container } = render(<Badge>Default</Badge>)
    expect(container.firstChild).toHaveClass('bde-badge--default')
  })

  it('applies success variant class', () => {
    const { container } = render(<Badge variant="success">OK</Badge>)
    expect(container.firstChild).toHaveClass('bde-badge--success')
  })

  it('applies warning variant class', () => {
    const { container } = render(<Badge variant="warning">Warn</Badge>)
    expect(container.firstChild).toHaveClass('bde-badge--warning')
  })

  it('applies danger variant class', () => {
    const { container } = render(<Badge variant="danger">Error</Badge>)
    expect(container.firstChild).toHaveClass('bde-badge--danger')
  })

  it('applies info variant class', () => {
    const { container } = render(<Badge variant="info">Info</Badge>)
    expect(container.firstChild).toHaveClass('bde-badge--info')
  })

  it('applies muted variant class', () => {
    const { container } = render(<Badge variant="muted">Muted</Badge>)
    expect(container.firstChild).toHaveClass('bde-badge--muted')
  })

  it('renders the dot element', () => {
    const { container } = render(<Badge>Test</Badge>)
    expect(container.querySelector('.bde-badge__dot')).toBeInTheDocument()
  })
})
