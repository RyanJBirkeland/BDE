import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingState } from '../LoadingState'

describe('LoadingState', () => {
  it('renders default message', () => {
    render(<LoadingState />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders custom message', () => {
    render(<LoadingState message="Loading tasks..." />)
    expect(screen.getByText('Loading tasks...')).toBeInTheDocument()
  })

  it('uses fleet-loading-state class', () => {
    const { container } = render(<LoadingState />)
    expect(container.firstChild).toHaveClass('fleet-loading-state')
  })

  it('applies custom className', () => {
    const { container } = render(<LoadingState className="custom" />)
    expect(container.firstChild).toHaveClass('fleet-loading-state')
    expect(container.firstChild).toHaveClass('custom')
  })
})
