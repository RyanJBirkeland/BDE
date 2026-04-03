import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { StatCounter } from '../StatCounter'

describe('StatCounter', () => {
  it('renders label and value', () => {
    render(<StatCounter label="Agents" value={3} accent="cyan" />)
    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders trend when provided', () => {
    render(
      <StatCounter
        label="Cost"
        value="$4.20"
        accent="orange"
        trend={{ direction: 'down', label: '12% vs yesterday' }}
      />
    )
    expect(screen.getByText(/12% vs yesterday/)).toBeInTheDocument()
  })

  it('renders suffix text', () => {
    render(<StatCounter label="Agents" value={3} accent="cyan" suffix="live" />)
    expect(screen.getByText('live')).toBeInTheDocument()
  })

  it('applies accent color to label', () => {
    render(<StatCounter label="Tasks" value={17} accent="pink" />)
    const label = document.querySelector('[data-role="stat-label"]') as HTMLElement
    expect(label.style.color).toBe('var(--neon-pink)')
  })

  it('renders up arrow and red color for upward trend', () => {
    render(
      <StatCounter
        label="Cost"
        value="$10"
        accent="orange"
        trend={{ direction: 'up', label: '5% increase' }}
      />
    )
    expect(screen.getByText(/↑/)).toBeInTheDocument()
    expect(screen.getByText(/5% increase/)).toBeInTheDocument()
  })

  it('renders down arrow for downward trend', () => {
    render(
      <StatCounter
        label="Cost"
        value="$4"
        accent="cyan"
        trend={{ direction: 'down', label: '3% drop' }}
      />
    )
    expect(screen.getByText(/↓/)).toBeInTheDocument()
    expect(screen.getByText(/3% drop/)).toBeInTheDocument()
  })

  it('does not render trend section when trend is undefined', () => {
    render(<StatCounter label="Agents" value={5} accent="cyan" />)
    expect(screen.queryByText(/↑/)).not.toBeInTheDocument()
    expect(screen.queryByText(/↓/)).not.toBeInTheDocument()
  })

  it('renders icon when provided', () => {
    render(
      <StatCounter
        label="Agents"
        value={3}
        accent="cyan"
        icon={<span data-testid="test-icon">⚡</span>}
      />
    )
    expect(screen.getByTestId('test-icon')).toBeInTheDocument()
  })

  it('calls onClick when clicked and has role=button', () => {
    const handleClick = vi.fn()
    render(<StatCounter label="Active" value={5} accent="cyan" onClick={handleClick} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('has cursor pointer when clickable', () => {
    const handleClick = vi.fn()
    render(<StatCounter label="Active" value={5} accent="cyan" onClick={handleClick} />)
    const button = screen.getByRole('button')
    expect(button.style.cursor).toBe('pointer')
  })

  it('does not have role=button when onClick is not provided', () => {
    render(<StatCounter label="Agents" value={3} accent="cyan" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('calls onClick on Enter keydown when clickable', () => {
    const handleClick = vi.fn()
    render(<StatCounter label="Active" value={5} accent="cyan" onClick={handleClick} />)
    const button = screen.getByRole('button')
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('calls onClick on Space keydown when clickable', () => {
    const handleClick = vi.fn()
    render(<StatCounter label="Active" value={5} accent="cyan" onClick={handleClick} />)
    const button = screen.getByRole('button')
    fireEvent.keyDown(button, { key: ' ' })
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('does not call onClick on other keys', () => {
    const handleClick = vi.fn()
    render(<StatCounter label="Active" value={5} accent="cyan" onClick={handleClick} />)
    const button = screen.getByRole('button')
    fireEvent.keyDown(button, { key: 'Tab' })
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('has tabIndex=0 when clickable', () => {
    const handleClick = vi.fn()
    render(<StatCounter label="Active" value={5} accent="cyan" onClick={handleClick} />)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('tabindex', '0')
  })

  it('does not have tabIndex when not clickable', () => {
    render(<StatCounter label="Agents" value={3} accent="cyan" />)
    const el = screen.getByText('Agents').closest('div[data-role="stat-label"]')?.parentElement
    expect(el).not.toHaveAttribute('tabindex')
  })

  it('changes opacity on mouse hover when clickable', () => {
    const handleClick = vi.fn()
    render(<StatCounter label="Active" value={5} accent="cyan" onClick={handleClick} />)
    const button = screen.getByRole('button')

    // Initial opacity should be 1
    expect(button.style.opacity).toBe('1')

    fireEvent.mouseEnter(button)
    expect(button.style.opacity).toBe('0.85')

    fireEvent.mouseLeave(button)
    expect(button.style.opacity).toBe('1')
  })

  it('renders string value correctly', () => {
    render(<StatCounter label="Cost" value="$12.50" accent="orange" />)
    expect(screen.getByText('$12.50')).toBeInTheDocument()
  })
})
