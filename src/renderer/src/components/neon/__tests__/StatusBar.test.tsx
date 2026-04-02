import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { StatusBar } from '../StatusBar'

describe('StatusBar', () => {
  it('renders title', () => {
    render(<StatusBar title="BDE Command Center" status="ok" />)
    expect(screen.getByText('BDE Command Center')).toBeInTheDocument()
  })

  it('renders status indicator dot', () => {
    const { container } = render(<StatusBar title="Test" status="ok" />)
    const dot = container.querySelector('[data-role="status-dot"]')
    expect(dot).toBeInTheDocument()
  })

  it('renders children in right slot', () => {
    render(
      <StatusBar title="Test" status="ok">
        <span>SYS.OK</span>
      </StatusBar>
    )
    expect(screen.getByText('SYS.OK')).toBeInTheDocument()
  })

  it('uses red dot for error status', () => {
    const { container } = render(<StatusBar title="Test" status="error" />)
    const dot = container.querySelector('[data-role="status-dot"]') as HTMLElement
    expect(dot.style.background).toBe('var(--neon-red)')
  })

  it('accepts accent prop for title color', () => {
    render(<StatusBar title="Test" status="ok" accent="cyan" />)
    const titleSpan = screen.getByText('Test')
    expect(titleSpan.style.color).toBe('var(--neon-cyan)')
  })

  it('defaults accent to purple', () => {
    render(<StatusBar title="Test" status="ok" />)
    const titleSpan = screen.getByText('Test')
    expect(titleSpan.style.color).toBe('var(--neon-purple)')
  })

  it('uses neon border token for bottom border', () => {
    const { container } = render(<StatusBar title="Test" status="ok" accent="cyan" />)
    const bar = container.firstChild as HTMLElement
    expect(bar.style.borderBottom).toContain('var(--neon-cyan-border)')
  })
})
