import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Spinner } from '../Spinner'

describe('Spinner', () => {
  it('renders with default md size', () => {
    const { container } = render(<Spinner />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders with sm size', () => {
    const { container } = render(<Spinner size="sm" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders with lg size', () => {
    const { container } = render(<Spinner size="lg" />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('applies custom color as borderTopColor', () => {
    const { container } = render(<Spinner color="red" />)
    const el = container.firstChild as HTMLElement
    expect(el.style.borderTopColor).toBe('red')
  })
})
