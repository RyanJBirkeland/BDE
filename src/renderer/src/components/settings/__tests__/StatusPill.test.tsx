/**
 * StatusPill — status indicator badge.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { StatusPill } from '../StatusPill'

describe('StatusPill', () => {
  it('renders label text', () => {
    render(<StatusPill label="Connected" variant="success" />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('applies variant class', () => {
    const { container } = render(<StatusPill label="Error" variant="error" />)
    const pill = container.querySelector('.stg-status-pill')
    expect(pill).toHaveClass('stg-status-pill--error')
  })

  it('applies success variant class', () => {
    const { container } = render(<StatusPill label="OK" variant="success" />)
    const pill = container.querySelector('.stg-status-pill')
    expect(pill).toHaveClass('stg-status-pill--success')
  })

  it('applies info variant class', () => {
    const { container } = render(<StatusPill label="Info" variant="info" />)
    const pill = container.querySelector('.stg-status-pill')
    expect(pill).toHaveClass('stg-status-pill--info')
  })

  it('applies warning variant class', () => {
    const { container } = render(<StatusPill label="Warning" variant="warning" />)
    const pill = container.querySelector('.stg-status-pill')
    expect(pill).toHaveClass('stg-status-pill--warning')
  })

  it('applies neutral variant class', () => {
    const { container } = render(<StatusPill label="Neutral" variant="neutral" />)
    const pill = container.querySelector('.stg-status-pill')
    expect(pill).toHaveClass('stg-status-pill--neutral')
  })

  it('renders green dot before label for success variant', () => {
    const { container } = render(<StatusPill label="Active" variant="success" />)
    const dot = container.querySelector('.stg-status-pill__dot')
    expect(dot).toBeInTheDocument()
  })

  it('does not render green dot for non-success variants', () => {
    const { container } = render(<StatusPill label="Pending" variant="warning" />)
    const dot = container.querySelector('.stg-status-pill__dot')
    expect(dot).not.toBeInTheDocument()
  })
})
