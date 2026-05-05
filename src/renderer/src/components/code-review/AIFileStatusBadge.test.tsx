import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AIFileStatusBadge } from './AIFileStatusBadge'

describe('AIFileStatusBadge', () => {
  it('renders a fail indicator for fail status', () => {
    render(<AIFileStatusBadge status="fail" />)
    expect(screen.getByRole('img', { name: /file has issues/i })).toBeInTheDocument()
  })

  it('renders an OK indicator for pass status', () => {
    render(<AIFileStatusBadge status="pass" />)
    expect(screen.getByRole('img', { name: /file reviewed clean/i })).toBeInTheDocument()
  })

  it('renders a concern indicator for concern status', () => {
    render(<AIFileStatusBadge status="concern" />)
    expect(screen.getByRole('img', { name: /file has concerns/i })).toBeInTheDocument()
  })

  it('renders nothing for unreviewed status', () => {
    const { container } = render(<AIFileStatusBadge status="unreviewed" />)
    expect(container.firstChild).toBeNull()
  })
})
