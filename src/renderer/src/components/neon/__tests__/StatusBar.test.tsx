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

  it('uses error class for error status', () => {
    const { container } = render(<StatusBar title="Test" status="error" />)
    const dot = container.querySelector('[data-role="status-dot"]') as HTMLElement
    expect(dot).toHaveClass('status-bar__dot--error')
  })

  it('applies aurora gradient class to title', () => {
    render(<StatusBar title="Test" status="ok" accent="cyan" />)
    const titleSpan = screen.getByText('Test')
    expect(titleSpan).toHaveClass('text-gradient-aurora')
  })

  it('title has aurora gradient class by default', () => {
    render(<StatusBar title="Test" status="ok" />)
    const titleSpan = screen.getByText('Test')
    expect(titleSpan).toHaveClass('text-gradient-aurora')
  })

  it('uses neon border token for bottom border', () => {
    const { container } = render(<StatusBar title="Test" status="ok" accent="cyan" />)
    const bar = container.firstChild as HTMLElement
    expect(bar.style.borderBottom).toContain('var(--bde-accent-border)')
  })
})
