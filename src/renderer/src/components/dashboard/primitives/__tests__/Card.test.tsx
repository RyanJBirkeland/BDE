import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from '../Card'

describe('Card', () => {
  it('renders its children', () => {
    render(
      <Card>
        <span>card content</span>
      </Card>
    )
    expect(screen.getByText('card content')).toBeInTheDocument()
  })

  it('uses the standard line color border by default', () => {
    const { container } = render(
      <Card>
        <span>plain</span>
      </Card>
    )
    const card = container.firstChild as HTMLElement
    expect(card.style.border).toContain('var(--line)')
  })

  it('switches to the failed-mix border when attention is true', () => {
    const { container } = render(
      <Card attention>
        <span>fire</span>
      </Card>
    )
    const card = container.firstChild as HTMLElement
    expect(card.style.border).toContain('var(--st-failed)')
  })

  it('forwards the className prop', () => {
    const { container } = render(
      <Card className="my-card">
        <span>plain</span>
      </Card>
    )
    const card = container.firstChild as HTMLElement
    expect(card.className).toBe('my-card')
  })
})
