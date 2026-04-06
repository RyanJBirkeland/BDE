import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { NavTooltip } from '../NavTooltip'

describe('NavTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders children', () => {
    render(
      <NavTooltip label="Dashboard" description="View dashboard">
        <button>Hover me</button>
      </NavTooltip>
    )
    expect(screen.getByText('Hover me')).toBeInTheDocument()
  })

  it('shows tooltip on hover after delay', async () => {
    render(
      <NavTooltip label="Dashboard" description="View metrics" delay={100}>
        <button>Hover me</button>
      </NavTooltip>
    )

    fireEvent.mouseEnter(screen.getByText('Hover me').parentElement!)
    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('View metrics')).toBeInTheDocument()
  })

  it('hides tooltip on mouse leave', () => {
    render(
      <NavTooltip label="Test" description="Desc" delay={0}>
        <button>Hover me</button>
      </NavTooltip>
    )

    const trigger = screen.getByText('Hover me').parentElement!
    fireEvent.mouseEnter(trigger)
    act(() => {
      vi.advanceTimersByTime(10)
    })
    fireEvent.mouseLeave(trigger)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows shortcut badge when provided', () => {
    render(
      <NavTooltip label="Test" description="Desc" shortcut="⌘1" delay={0}>
        <button>Hover me</button>
      </NavTooltip>
    )

    const trigger = screen.getByText('Hover me').parentElement!
    fireEvent.mouseEnter(trigger)
    act(() => {
      vi.advanceTimersByTime(10)
    })
    expect(screen.getByText('⌘1')).toBeInTheDocument()
  })

  it('hides tooltip on Escape key', () => {
    render(
      <NavTooltip label="Test" description="Desc" delay={0}>
        <button>Hover me</button>
      </NavTooltip>
    )

    const trigger = screen.getByText('Hover me').parentElement!
    fireEvent.mouseEnter(trigger)
    act(() => {
      vi.advanceTimersByTime(10)
    })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
