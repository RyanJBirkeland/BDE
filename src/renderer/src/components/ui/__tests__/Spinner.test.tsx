import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Spinner } from '../Spinner'

describe('Spinner', () => {
  it('renders with default md size', () => {
    const { container } = render(<Spinner />)
    const el = container.querySelector('.bde-spinner')!
    expect(el).toBeInTheDocument()
    expect(el).toHaveClass('bde-spinner--md')
  })

  it('renders with sm size', () => {
    const { container } = render(<Spinner size="sm" />)
    expect(container.querySelector('.bde-spinner--sm')).toBeInTheDocument()
  })

  it('renders with lg size', () => {
    const { container } = render(<Spinner size="lg" />)
    expect(container.querySelector('.bde-spinner--lg')).toBeInTheDocument()
  })

  it('applies custom color as borderTopColor', () => {
    const { container } = render(<Spinner color="red" />)
    const el = container.querySelector('.bde-spinner') as HTMLElement
    expect(el.style.borderTopColor).toBe('red')
  })
})
