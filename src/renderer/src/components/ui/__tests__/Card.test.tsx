import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Card } from '../Card'

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Hello</Card>)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('applies default medium padding class', () => {
    const { container } = render(<Card>Content</Card>)
    expect(container.firstChild).toHaveClass('bde-card--pad-md')
  })

  it('applies custom padding class', () => {
    const { container } = render(<Card padding="sm">Content</Card>)
    expect(container.firstChild).toHaveClass('bde-card--pad-sm')
  })

  it('applies none padding class', () => {
    const { container } = render(<Card padding="none">Content</Card>)
    expect(container.firstChild).toHaveClass('bde-card--pad-none')
  })

  it('applies active class when active', () => {
    const { container } = render(<Card active>Content</Card>)
    expect(container.firstChild).toHaveClass('bde-card--active')
  })

  it('applies clickable class when onClick provided', () => {
    const { container } = render(<Card onClick={() => {}}>Content</Card>)
    expect(container.firstChild).toHaveClass('bde-card--clickable')
  })

  it('applies custom className', () => {
    const { container } = render(<Card className="custom">Content</Card>)
    expect(container.firstChild).toHaveClass('custom')
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<Card onClick={onClick}>Content</Card>)
    fireEvent.click(screen.getByText('Content'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('sets role="button" when clickable', () => {
    render(<Card onClick={() => {}}>Content</Card>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('handles Enter key press', () => {
    const onClick = vi.fn()
    render(<Card onClick={onClick}>Content</Card>)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
    expect(onClick).toHaveBeenCalled()
  })

  it('handles Space key press', () => {
    const onClick = vi.fn()
    render(<Card onClick={onClick}>Content</Card>)
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' })
    expect(onClick).toHaveBeenCalled()
  })

  it('does not set role when not clickable', () => {
    render(<Card>Content</Card>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
