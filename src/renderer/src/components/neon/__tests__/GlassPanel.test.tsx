import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { GlassPanel } from '../GlassPanel'

describe('GlassPanel', () => {
  it('renders children', () => {
    render(<GlassPanel>Panel content</GlassPanel>)
    expect(screen.getByText('Panel content')).toBeInTheDocument()
  })

  it('does not apply backdrop-filter (glow stripped)', () => {
    const { container } = render(<GlassPanel>X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.backdropFilter).toBeFalsy()
  })

  it('applies accent border when provided', () => {
    const { container } = render(<GlassPanel accent="purple">X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.border).toContain('var(--fleet-accent-border)')
  })

  it('uses CSS custom property for borderRadius', () => {
    const { container } = render(<GlassPanel>X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.borderRadius).toBe('var(--fleet-radius-xl)')
  })

  it('uses surfaceDeep background without accent', () => {
    const { container } = render(<GlassPanel>X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.background).toBe('var(--fleet-bg)')
  })

  it('uses gradient background with accent', () => {
    const { container } = render(<GlassPanel accent="cyan">X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.background).toContain('linear-gradient')
    expect(panel.style.background).toContain('var(--fleet-accent-surface)')
  })

  it('accepts blur prop without applying it (ignored)', () => {
    const { container } = render(<GlassPanel blur="sm">X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.backdropFilter).toBeFalsy()
  })

  it('applies custom className', () => {
    const { container } = render(<GlassPanel className="custom-panel">X</GlassPanel>)
    expect(container.firstChild).toHaveClass('glass-panel', 'custom-panel')
  })

  it('applies custom style prop', () => {
    const { container } = render(<GlassPanel style={{ padding: '20px' }}>X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.padding).toBe('20px')
  })

  it('uses border token when no accent', () => {
    const { container } = render(<GlassPanel>X</GlassPanel>)
    const panel = container.firstChild as HTMLElement
    expect(panel.style.border).toContain('var(--fleet-border)')
  })
})
