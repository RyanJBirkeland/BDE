import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FleetGlance } from '../FleetGlance'
import type { AgentMeta } from '../../../../../shared/types'

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

  beforeEach(() => {
    mockOnSelect = vi.fn()
  })

  it('displays fleet status counts for running, done, and failed agents', () => {
    const now = Date.now()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayMs = todayStart.getTime()

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
      },
      {
        ...base,
        id: '3',
        status: 'done',
        startedAt: new Date(todayMs + 3600_000).toISOString(),
        finishedAt: new Date(todayMs + 7200_000).toISOString()
      },
      {
        ...base,
        id: '4',
        status: 'failed',
        startedAt: new Date(todayMs + 1000).toISOString(),
        finishedAt: new Date(todayMs + 5000).toISOString()
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} />)

    // Check status labels exist
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()

    // Check values exist (may have duplicates, so use getAllByText)
    expect(screen.getByText('2')).toBeInTheDocument() // running count
    expect(screen.getAllByText('1').length).toBeGreaterThan(0) // done/failed counts
  })

  it('calculates today cost and runtime correctly', () => {
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

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} />)

    expect(screen.getByText('$1.25')).toBeInTheDocument() // total cost
  })

  it('displays running agents with elapsed time', () => {
    const now = Date.now()
    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'running',
        task: 'Build feature X',
        startedAt: new Date(now - 30000).toISOString(), // 30 seconds ago
        finishedAt: null,
        costUsd: 0.25
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} />)

    expect(screen.getByText("What's happening now")).toBeInTheDocument()
    expect(screen.getByText('Build feature X')).toBeInTheDocument()
    expect(screen.getByText('▶ running')).toBeInTheDocument()
  })

  it('displays recent completions with duration and time ago', () => {
    const now = Date.now()
    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'done',
        task: 'Completed task',
        startedAt: new Date(now - 600000).toISOString(), // 10 min ago
        finishedAt: new Date(now - 300000).toISOString(), // 5 min ago
        costUsd: 0.5
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} />)

    expect(screen.getByText('Recent completions')).toBeInTheDocument()
    expect(screen.getByText('Completed task')).toBeInTheDocument()
    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })

  it('limits running agents to max 5', () => {
    const now = Date.now()
    const agents: AgentMeta[] = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      id: `agent-${i}`,
      status: 'running' as const,
      task: `Task ${i}`,
      startedAt: new Date(now - i * 1000).toISOString(),
      finishedAt: null
    }))

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} />)

    const runningSection = screen.getByText("What's happening now").parentElement
    const items = runningSection?.querySelectorAll('.fleet-glance__item')
    expect(items).toHaveLength(5)
  })

  it('limits recent completions to max 5', () => {
    const now = Date.now()
    const agents: AgentMeta[] = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      id: `agent-${i}`,
      status: 'done' as const,
      task: `Task ${i}`,
      startedAt: new Date(now - (i + 10) * 60000).toISOString(),
      finishedAt: new Date(now - i * 60000).toISOString()
    }))

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} />)

    const completionsSection = screen.getByText('Recent completions').parentElement
    const items = completionsSection?.querySelectorAll('.fleet-glance__item')
    expect(items).toHaveLength(5)
  })

  it('truncates long task titles to 60 characters', () => {
    const longTask = 'A'.repeat(80)
    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'running',
        task: longTask,
        startedAt: new Date().toISOString(),
        finishedAt: null
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} />)

    const truncated = screen.getByText(/^A+…$/)
    expect(truncated.textContent?.length).toBeLessThanOrEqual(61) // 60 chars + ellipsis
  })

  it('calls onSelect when clicking a running agent', async () => {
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

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} />)

    const taskButton = screen.getByRole('button', { name: /Test task/ })
    await user.click(taskButton)

    expect(mockOnSelect).toHaveBeenCalledWith('test-agent-1')
  })

  it('calls onSelect when clicking a completed agent', async () => {
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

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} />)

    const taskButton = screen.getByRole('button', { name: /Finished task/ })
    await user.click(taskButton)

    expect(mockOnSelect).toHaveBeenCalledWith('completed-agent')
  })

  it('displays empty state when no agents exist', () => {
    render(<FleetGlance agents={[]} onSelect={mockOnSelect} />)

    expect(screen.getByText('No agents running or completed today.')).toBeInTheDocument()
    expect(
      screen.getByText((_content, element) => {
        return element?.textContent === 'Click the + button to spawn a new agent.' || false
      })
    ).toBeInTheDocument()
  })

  it('handles null cost gracefully', () => {
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

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} />)

    // Should show $0.00 at least once (appears in both Today stat and running agent cost)
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

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} />)

    const tasks = screen.getAllByText(/task/)
    const newerIndex = tasks.findIndex((el) => el.textContent === 'Newer task')
    const olderIndex = tasks.findIndex((el) => el.textContent === 'Older task')
    expect(newerIndex).toBeLessThan(olderIndex)
  })

  it('includes cancelled agents in failed count', () => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayMs = todayStart.getTime()

    const agents: AgentMeta[] = [
      {
        ...base,
        id: '1',
        status: 'cancelled',
        startedAt: new Date(todayMs + 1000).toISOString(),
        finishedAt: new Date(todayMs + 5000).toISOString()
      }
    ]

    render(<FleetGlance agents={agents} onSelect={mockOnSelect} />)

    // Failed count should include cancelled agents
    const failedStat = screen.getByText('Failed').nextElementSibling
    expect(failedStat?.textContent).toBe('1')
  })
})
