import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { GlassPanel } from '../GlassPanel'

describe('GlassPanel', () => {
  it('renders children', () => {
    render(<GlassPanel>Panel content</GlassPanel>)
    expect(screen.getByText('Panel content')).toBeInTheDocument()
  })

  it('applies glass backdrop-filter', () => {
    const { container } = render(<GlassPanel>X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.backdropFilter).toBeTruthy()
  })

  it('applies accent border when provided', () => {
    const { container } = render(<GlassPanel accent="purple">X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.border).toContain('var(--neon-purple-border)')
  })

  it('uses token borderRadius', () => {
    const { container } = render(<GlassPanel>X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.borderRadius).toBe('12px')
  })

  it('uses surfaceDeep background without accent', () => {
    const { container } = render(<GlassPanel>X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.background).toBe('var(--neon-surface-deep)')
  })
})
