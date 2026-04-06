import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
    sel({ tasks: [{ id: 'task-1', title: 'My Task' }] })
  )
}))

import { AgentMonitor } from '../AgentMonitor'

describe('AgentMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(window.api.agentManager.status).mockResolvedValue({
      running: true,
      shuttingDown: false,
      concurrency: {
        maxSlots: 3,
        effectiveSlots: 3,
        activeCount: 1,
        recoveryDueAt: null,
        consecutiveRateLimits: 0,
        atFloor: false
      },
      activeAgents: [
        {
          agentRunId: 'run-1',
          taskId: 'task-1',
          startedAt: Date.now() - 60000,
          costUsd: 0.05,
          model: 'sonnet',
          lastOutputAt: Date.now(),
          rateLimitCount: 0,
          tokensIn: 1000,
          tokensOut: 500
        }
      ]
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when no agents active', async () => {
    vi.mocked(window.api.agentManager.status).mockResolvedValue({
      running: false,
      shuttingDown: false,
      concurrency: {
        maxSlots: 0,
        effectiveSlots: 0,
        activeCount: 0,
        recoveryDueAt: null,
        consecutiveRateLimits: 0,
        atFloor: false
      },
      activeAgents: []
    })

    const { container } = render(<AgentMonitor />)
    await vi.advanceTimersByTimeAsync(0)
    // Should render empty
    expect(container.textContent).toBe('')
  })

  it('shows agent count pill when agents active', async () => {
    render(<AgentMonitor />)
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('agent running')).toBeInTheDocument()
  })

  it('expands to show details when clicked', async () => {
    render(<AgentMonitor />)
    await vi.advanceTimersByTimeAsync(0)
    fireEvent.click(screen.getByLabelText(/agents running/i))
    expect(screen.getByText('Active Agents')).toBeInTheDocument()
  })

  it('collapses when collapse button clicked', async () => {
    render(<AgentMonitor />)
    await vi.advanceTimersByTimeAsync(0)
    fireEvent.click(screen.getByLabelText(/agents running/i))
    expect(screen.getByText('Active Agents')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Collapse agent monitor'))
    expect(screen.queryByText('Active Agents')).not.toBeInTheDocument()
  })
})
