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
    // Loading state adds a child spinner element
    expect(btn.childElementCount).toBeGreaterThanOrEqual(1)
  })

  it('renders with primary variant', () => {
    render(<Button variant="primary">Primary</Button>)
    expect(screen.getByRole('button', { name: 'Primary' })).toBeInTheDocument()
  })

  it('renders with ghost variant (default)', () => {
    render(<Button>Ghost</Button>)
    expect(screen.getByRole('button', { name: 'Ghost' })).toBeInTheDocument()
  })

  it('renders with danger variant', () => {
    render(<Button variant="danger">Danger</Button>)
    expect(screen.getByRole('button', { name: 'Danger' })).toBeInTheDocument()
  })

  it('renders with icon variant', () => {
    render(<Button variant="icon">Icon</Button>)
    expect(screen.getByRole('button', { name: 'Icon' })).toBeInTheDocument()
  })

  it('renders correctly when loading', () => {
    render(<Button loading>Wait</Button>)
    const btn = screen.getByRole('button', { name: 'Wait' })
    expect(btn).toBeDisabled()
  })
})
