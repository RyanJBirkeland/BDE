import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NeonBadge } from '../NeonBadge'

describe('NeonBadge', () => {
  it('renders label text', () => {
    render(<NeonBadge accent="cyan" label="active" />)
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('applies accent color styling', () => {
    const { container } = render(<NeonBadge accent="pink" label="queued" />)
    const badge = container.firstChild as HTMLElement
    expect(badge.style.color).toBe('var(--fleet-status-done)')
    expect(badge.style.background).toContain('var(--fleet-accent-surface)')
  })

  it('adds pulse class when pulse prop is true', () => {
    const { container } = render(<NeonBadge accent="cyan" label="live" pulse />)
    expect(container.firstChild).toHaveClass('fleet-badge--pulse')
  })

  it('has base badge class', () => {
    const { container } = render(<NeonBadge accent="cyan" label="test" />)
    const badge = container.firstChild as HTMLElement
    expect(badge).toHaveClass('fleet-badge')
  })
})
