// src/renderer/src/components/neon/__tests__/NeonCard.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NeonCard } from '../NeonCard'

describe('NeonCard', () => {
  it('renders children', () => {
    render(<NeonCard accent="cyan">Hello Neon</NeonCard>)
    expect(screen.getByText('Hello Neon')).toBeInTheDocument()
  })

  it('applies accent-based CSS variables via style', () => {
    const { container } = render(<NeonCard accent="pink">Content</NeonCard>)
    const card = container.firstChild as HTMLElement
    expect(card.style.getPropertyValue('--card-accent')).toBe('var(--neon-pink)')
    expect(card.style.getPropertyValue('--card-accent-border')).toBe('var(--neon-pink-border)')
    expect(card.style.getPropertyValue('--card-accent-surface')).toBe('var(--neon-pink-surface)')
  })

  it('applies custom className', () => {
    const { container } = render(
      <NeonCard accent="blue" className="custom">
        X
      </NeonCard>
    )
    expect(container.firstChild).toHaveClass('neon-card', 'custom')
  })

  it('renders with header when title is provided', () => {
    render(
      <NeonCard accent="purple" title="Status" icon={<span data-testid="icon">I</span>}>
        Body
      </NeonCard>
    )
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('defaults accent to purple when not specified', () => {
    const { container } = render(<NeonCard>Default</NeonCard>)
    const card = container.firstChild as HTMLElement
    expect(card.style.getPropertyValue('--card-accent')).toBe('var(--neon-purple)')
  })

  it('renders action in header when provided', () => {
    render(
      <NeonCard accent="cyan" title="Test" action={<button data-testid="action-btn">Click</button>}>
        Body
      </NeonCard>
    )
    expect(screen.getByTestId('action-btn')).toBeInTheDocument()
    expect(screen.getByText('Click')).toBeInTheDocument()
  })

  it('does not render action when not provided', () => {
    render(
      <NeonCard accent="cyan" title="Test">
        Body
      </NeonCard>
    )
    expect(screen.queryByTestId('action-btn')).not.toBeInTheDocument()
  })

  it('does not render header when title is not provided', () => {
    const { container } = render(<NeonCard accent="cyan">Body only</NeonCard>)
    // No title text should be rendered
    expect(container.querySelectorAll('span')).toHaveLength(0)
  })

  it('renders without icon in header when icon is not provided', () => {
    render(
      <NeonCard accent="cyan" title="No Icon">
        Body
      </NeonCard>
    )
    expect(screen.getByText('No Icon')).toBeInTheDocument()
  })

  it('applies custom style prop', () => {
    const { container } = render(
      <NeonCard accent="cyan" style={{ marginTop: '10px' }}>
        Styled
      </NeonCard>
    )
    const card = container.firstChild as HTMLElement
    expect(card.style.marginTop).toBe('10px')
  })
})
