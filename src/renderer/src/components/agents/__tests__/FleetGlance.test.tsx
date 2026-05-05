import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FleetGlance } from '../FleetGlance'
import type { AgentMeta } from '../../../../../shared/types'

vi.mock('../../../stores/sprintTasks', () => ({
  useSprintTasks: vi.fn((sel: (s: { tasks: unknown[] }) => unknown) => sel({ tasks: [] })),
  selectReviewTaskCount: (s: { tasks: Array<{ status: string }> }) =>
    s.tasks.filter((t) => t.status === 'review').length
}))

const base: Omit<AgentMeta, 'id' | 'status' | 'startedAt' | 'finishedAt'> = {
  pid: null,
  bin: 'claude',
  model: 'sonnet',
  repo: 'test',
  repoPath: '/tmp/test',
  task: 'do stuff',
  exitCode: null,
  logPath: '/tmp/log',
  source: 'fleet',
  costUsd: null,
  tokensIn: null,
  tokensOut: null,
  sprintTaskId: null
}

describe('FleetGlance', () => {
  let mockOnSelect: (id: string) => void
  let mockOnSpawn: () => void

  beforeEach(() => {
    mockOnSelect = vi.fn()
    mockOnSpawn = vi.fn()
  })

  it('renders V2 header with FLEET · GLANCE eyebrow and title', () => {
    render(<FleetGlance agents={[]} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    expect(screen.getByText('FLEET · GLANCE')).toBeInTheDocument()
    expect(screen.getByText('Pick an agent to focus, or spawn a new one')).toBeInTheDocument()
  })

  it('renders Spawn agent button in header', () => {
    render(<FleetGlance agents={[]} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    const spawnButtons = screen.getAllByRole('button', { name: /Spawn agent/i })
    expect(spawnButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('calls onSpawn when header Spawn button is clicked', async () => {
    const user = userEvent.setup()
    render(<FleetGlance agents={[]} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    const spawnButton = screen.getAllByRole('button', { name: /\+ Spawn agent/i })[0]
    await user.click(spawnButton)

    expect(mockOnSpawn).toHaveBeenCalledOnce()
  })

  it('displays fleet metrics row with live, review, done·24h, cost·24h labels', () => {
    render(<FleetGlance agents={[]} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    expect(screen.getByText('live')).toBeInTheDocument()
    expect(screen.getByText('review')).toBeInTheDocument()
    expect(screen.getByText('done · 24h')).toBeInTheDocument()
    expect(screen.getByText('cost · 24h')).toBeInTheDocument()
  })

  it('shows live count in metrics for running agents', () => {
    const now = Date.now()
    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'running',
        startedAt: new Date(now).toISOString(),
        finishedAt: null
      },
      {
        ...base,
        id: '2',
        status: 'running',
        startedAt: new Date(now - 1000).toISOString(),
        finishedAt: null
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    // live metric should show 2
    const liveLabel = screen.getByText('live')
    const metricValue = liveLabel.nextElementSibling
    expect(metricValue?.textContent).toBe('2')
  })

  it('shows today cost in metrics row', () => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayMs = todayStart.getTime()

    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'done',
        startedAt: new Date(todayMs).toISOString(),
        finishedAt: new Date(todayMs + 60000).toISOString(),
        costUsd: 0.5
      },
      {
        ...base,
        id: '2',
        status: 'done',
        startedAt: new Date(todayMs + 60000).toISOString(),
        finishedAt: new Date(todayMs + 120000).toISOString(),
        costUsd: 0.75
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    expect(screen.getByText('$1.25')).toBeInTheDocument()
  })

  it('renders running agents as tiles with fleet-pulse', () => {
    const now = Date.now()
    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'running',
        task: 'Build feature X',
        startedAt: new Date(now - 30000).toISOString(),
        finishedAt: null
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    expect(screen.getByText('Build feature X')).toBeInTheDocument()
    // Running tiles carry fleet-pulse
    expect(document.querySelector('.fleet-pulse')).not.toBeNull()
  })

  it('renders recent completions when no running agents', () => {
    const now = Date.now()
    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'done',
        task: 'Completed task',
        startedAt: new Date(now - 600000).toISOString(),
        finishedAt: new Date(now - 300000).toISOString()
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    expect(screen.getByText('Completed task')).toBeInTheDocument()
    // Non-running tiles must not carry fleet-pulse
    expect(document.querySelector('.fleet-pulse')).toBeNull()
  })

  it('limits running agents to max 6 tiles', () => {
    const now = Date.now()
    const agents: AgentMeta[] = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      id: `agent-${i}`,
      status: 'running' as const,
      task: `Task ${i}`,
      startedAt: new Date(now - i * 1000).toISOString(),
      finishedAt: null
    }))

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    // 6 tile buttons (each tile is a button) + spawn buttons in header/empty-state
    const pulses = document.querySelectorAll('.fleet-pulse')
    expect(pulses.length).toBeLessThanOrEqual(6)
  })

  it('limits recent completions to max 5 tiles', () => {
    const now = Date.now()
    const agents: AgentMeta[] = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      id: `agent-${i}`,
      status: 'done' as const,
      task: `Task ${i}`,
      startedAt: new Date(now - (i + 10) * 60000).toISOString(),
      finishedAt: new Date(now - i * 60000).toISOString()
    }))

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    // All done agents render as tiles; slice(0,5) means max 5 task names shown
    const taskElements = screen.getAllByText(/^Task \d+$/)
    expect(taskElements.length).toBeLessThanOrEqual(5)
  })

  it('calls onSelect when clicking a running agent tile', async () => {
    const user = userEvent.setup()
    const agents: AgentMeta[] = [
      {
        ...base,
        id: 'test-agent-1',
        status: 'running',
        task: 'Test task',
        startedAt: new Date().toISOString(),
        finishedAt: null
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    const taskButton = screen.getByRole('button', { name: /Test task/ })
    await user.click(taskButton)

    expect(mockOnSelect).toHaveBeenCalledWith('test-agent-1')
  })

  it('calls onSelect when clicking a completed agent tile', async () => {
    const user = userEvent.setup()
    const now = Date.now()
    const agents: AgentMeta[] = [
      {
        ...base,
        id: 'completed-agent',
        status: 'done',
        task: 'Finished task',
        startedAt: new Date(now - 60000).toISOString(),
        finishedAt: new Date(now).toISOString()
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    const taskButton = screen.getByRole('button', { name: /Finished task/ })
    await user.click(taskButton)

    expect(mockOnSelect).toHaveBeenCalledWith('completed-agent')
  })

  it('displays empty state when no agents exist', () => {
    render(<FleetGlance agents={[]} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    expect(screen.getByText('No agents running or completed today.')).toBeInTheDocument()
  })

  it('calls onSpawn from empty state when spawn button is clicked', async () => {
    const user = userEvent.setup()
    render(<FleetGlance agents={[]} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    // Both header and empty-state have a spawn button; clicking any calls onSpawn
    const spawnButtons = screen.getAllByRole('button', { name: /\+ Spawn agent/i })
    await user.click(spawnButtons[0])

    expect(mockOnSpawn).toHaveBeenCalled()
  })

  it('handles null cost gracefully by showing $0.00', () => {
    const now = Date.now()
    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'running',
        task: 'Task with no cost',
        startedAt: new Date(now).toISOString(),
        finishedAt: null,
        costUsd: null
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0)
  })

  it('sorts recent completions by finishedAt descending', () => {
    const now = Date.now()
    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'done',
        task: 'Older task',
        startedAt: new Date(now - 120000).toISOString(),
        finishedAt: new Date(now - 60000).toISOString()
      },
      {
        ...base,
        id: '2',
        status: 'done',
        task: 'Newer task',
        startedAt: new Date(now - 30000).toISOString(),
        finishedAt: new Date(now - 10000).toISOString()
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    const tasks = screen.getAllByText(/task/)
    const newerIndex = tasks.findIndex((el) => el.textContent === 'Newer task')
    const olderIndex = tasks.findIndex((el) => el.textContent === 'Older task')
    expect(newerIndex).toBeLessThan(olderIndex)
  })

  it('includes cancelled agents in recent completions', () => {
    const now = Date.now()
    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'cancelled',
        task: 'Cancelled task',
        startedAt: new Date(now - 5000).toISOString(),
        finishedAt: new Date(now - 1000).toISOString()
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} onSpawn={mockOnSpawn} />)

    expect(screen.getByText('Cancelled task')).toBeInTheDocument()
  })
})
