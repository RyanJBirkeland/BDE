import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Tooltip } from '../Tooltip'

describe('Tooltip', () => {
  it('renders children', () => {
    render(<Tooltip content="Hint">Hover me</Tooltip>)
    expect(screen.getByText('Hover me')).toBeInTheDocument()
  })

  it('sets data-tooltip attribute', () => {
    const { container } = render(<Tooltip content="Hint text">Child</Tooltip>)
    expect(container.firstChild).toHaveAttribute('data-tooltip', 'Hint text')
  })

  it('applies top side class by default', () => {
    const { container } = render(<Tooltip content="Hint">Child</Tooltip>)
    expect(container.firstChild).toHaveClass('bde-tooltip--top')
  })

  it('applies custom side class', () => {
    const { container } = render(
      <Tooltip content="Hint" side="bottom">
        Child
      </Tooltip>
    )
    expect(container.firstChild).toHaveClass('bde-tooltip--bottom')
  })
})
