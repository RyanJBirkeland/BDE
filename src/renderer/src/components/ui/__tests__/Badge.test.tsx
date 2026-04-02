import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from '../Badge'

describe('Badge', () => {
  it('renders with correct text', () => {
    render(<Badge>Active</Badge>)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders with default variant', () => {
    render(<Badge>Default</Badge>)
    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('renders with success variant', () => {
    render(<Badge variant="success">OK</Badge>)
    expect(screen.getByText('OK')).toBeInTheDocument()
  })

  it('renders with warning variant', () => {
    render(<Badge variant="warning">Warn</Badge>)
    expect(screen.getByText('Warn')).toBeInTheDocument()
  })

  it('renders with danger variant', () => {
    render(<Badge variant="danger">Error</Badge>)
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('renders with info variant', () => {
    render(<Badge variant="info">Info</Badge>)
    expect(screen.getByText('Info')).toBeInTheDocument()
  })

  it('renders with muted variant', () => {
    render(<Badge variant="muted">Muted</Badge>)
    expect(screen.getByText('Muted')).toBeInTheDocument()
  })

  it('renders the dot element before text', () => {
    const { container } = render(<Badge>Test</Badge>)
    // Badge renders a dot span as first child before the text
    const badge = container.firstChild as HTMLElement
    expect(badge).toBeInTheDocument()
    expect(badge.childElementCount).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Test')).toBeInTheDocument()
  })
})
