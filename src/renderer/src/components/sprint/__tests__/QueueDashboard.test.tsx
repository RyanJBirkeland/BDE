import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueueDashboard } from '../QueueDashboard'
import type { QueueHealth } from '../../../stores/sprintEvents'

function makeHealth(overrides: Partial<QueueHealth> = {}): QueueHealth {
  return {
    queue: { backlog: 0, queued: 0, active: 0, done: 0, failed: 0, cancelled: 0 },
    doneToday: 0,
    connectedRunners: 0,
    ...overrides,
  }
}

describe('QueueDashboard', () => {
  it('shows null state when health is null', () => {
    render(<QueueDashboard health={null} />)
    expect(screen.getByText('Queue API inactive')).toBeInTheDocument()
  })

  it('shows "Runner connected" when connectedRunners > 0', () => {
    render(<QueueDashboard health={makeHealth({ connectedRunners: 1 })} />)
    expect(screen.getByText('Runner connected')).toBeInTheDocument()
  })

  it('shows "No runner connected" when connectedRunners is 0', () => {
    render(<QueueDashboard health={makeHealth({ connectedRunners: 0 })} />)
    expect(screen.getByText('No runner connected')).toBeInTheDocument()
  })

  it('renders green dot when connected', () => {
    render(<QueueDashboard health={makeHealth({ connectedRunners: 2 })} />)
    const dot = screen.getByTestId('runner-dot')
    // jsdom normalizes hex to rgb
    expect(dot.style.backgroundColor).toBe('rgb(0, 211, 127)')
  })

  it('renders gray dot when disconnected', () => {
    render(<QueueDashboard health={makeHealth({ connectedRunners: 0 })} />)
    const dot = screen.getByTestId('runner-dot')
    expect(dot.style.backgroundColor).toBe('rgb(85, 85, 85)')
  })

  it('displays correct stat counts', () => {
    const health = makeHealth({
      queue: { backlog: 3, queued: 5, active: 2, done: 15, failed: 1, cancelled: 0 },
      doneToday: 4,
      connectedRunners: 1,
    })
    render(<QueueDashboard health={health} />)

    // Check queued
    expect(screen.getByText('5')).toBeInTheDocument()
    // Check active
    expect(screen.getByText('2')).toBeInTheDocument()
    // Check done today
    expect(screen.getByText('4')).toBeInTheDocument()
    // Check failed
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('shows failed count in red when > 0', () => {
    const health = makeHealth({
      queue: { backlog: 0, queued: 0, active: 0, done: 0, failed: 3, cancelled: 0, error: 1 },
    })
    render(<QueueDashboard health={health} />)

    const failedEl = screen.getByTestId('failed-count')
    expect(failedEl.textContent).toBe('4')
    // jsdom normalizes hex to rgb — #FF4D4D -> rgb(255, 77, 77)
    expect(failedEl.style.color).toBe('rgb(255, 77, 77)')
  })

  it('shows failed count in default color when 0', () => {
    const health = makeHealth({
      queue: { backlog: 0, queued: 0, active: 0, done: 0, failed: 0, cancelled: 0 },
    })
    render(<QueueDashboard health={health} />)

    const failedEl = screen.getByTestId('failed-count')
    expect(failedEl.textContent).toBe('0')
    // jsdom normalizes hex to rgb — #E8E8E8 -> rgb(232, 232, 232)
    expect(failedEl.style.color).toBe('rgb(232, 232, 232)')
  })

  it('sums failed + error for the failed count', () => {
    const health = makeHealth({
      queue: { backlog: 0, queued: 0, active: 0, done: 0, failed: 2, cancelled: 0, error: 3 },
    })
    render(<QueueDashboard health={health} />)

    const failedEl = screen.getByTestId('failed-count')
    expect(failedEl.textContent).toBe('5')
  })

  it('has the queue-dashboard test id', () => {
    render(<QueueDashboard health={null} />)
    expect(screen.getByTestId('queue-dashboard')).toBeInTheDocument()
  })
})
