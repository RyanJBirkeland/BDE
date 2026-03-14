import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '../Button'

describe('Button', () => {
  it('renders with correct text', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Press</Button>)

    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('is disabled when loading', () => {
    render(<Button loading>Loading</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn.querySelector('.bde-btn__spinner')).toBeInTheDocument()
  })

  it('applies primary variant class', () => {
    render(<Button variant="primary">Primary</Button>)
    expect(screen.getByRole('button')).toHaveClass('bde-btn--primary')
  })

  it('applies ghost variant class (default)', () => {
    render(<Button>Ghost</Button>)
    expect(screen.getByRole('button')).toHaveClass('bde-btn--ghost')
  })

  it('applies danger variant class', () => {
    render(<Button variant="danger">Danger</Button>)
    expect(screen.getByRole('button')).toHaveClass('bde-btn--danger')
  })

  it('applies icon variant class', () => {
    render(<Button variant="icon">Icon</Button>)
    expect(screen.getByRole('button')).toHaveClass('bde-btn--icon')
  })

  it('applies loading class when loading', () => {
    render(<Button loading>Wait</Button>)
    expect(screen.getByRole('button')).toHaveClass('bde-btn--loading')
  })
})
