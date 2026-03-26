import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentTimeline } from '../AgentTimeline'
import type { AgentMeta } from '../../../../../shared/types'

function makeAgent(overrides: Partial<AgentMeta> = {}): AgentMeta {
  return {
    id: 'agent-1',
    pid: 123,
    bin: 'claude',
    model: 'claude-sonnet',
    repo: 'BDE',
    repoPath: '/tmp/bde',
    task: 'Fix the login bug',
    startedAt: new Date('2024-01-01T10:00:00Z').toISOString(),
    finishedAt: null,
    exitCode: null,
    status: 'running',
    logPath: '/tmp/log',
    source: 'bde',
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    sprintTaskId: null,
    ...overrides
  }
}

describe('AgentTimeline', () => {
  const defaultProps = {
    agents: [],
    onSelectAgent: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders timeline container', () => {
    const { container } = render(<AgentTimeline {...defaultProps} />)
    const timeline = container.querySelector('.agent-timeline')
    expect(timeline).toBeInTheDocument()
  })

  it('renders timeline bars for agents within time range', () => {
    const now = Date.now()
    const twoHoursAgo = new Date(now - 2 * 3600 * 1000).toISOString()
    const oneHourAgo = new Date(now - 1 * 3600 * 1000).toISOString()

    const agents = [
      makeAgent({ id: 'agent-1', startedAt: twoHoursAgo, finishedAt: oneHourAgo, status: 'done' }),
      makeAgent({ id: 'agent-2', startedAt: oneHourAgo, status: 'running' })
    ]

    const { container } = render(<AgentTimeline {...defaultProps} agents={agents} />)
    const bars = container.querySelectorAll('.timeline-bar')
    expect(bars.length).toBe(2)
  })

  it('does not render agents outside time range', () => {
    const now = Date.now()
    const eightHoursAgo = new Date(now - 8 * 3600 * 1000).toISOString()
    const sevenHoursAgo = new Date(now - 7 * 3600 * 1000).toISOString()

    const agents = [
      // This agent is outside the 6-hour window
      makeAgent({
        id: 'agent-old',
        startedAt: eightHoursAgo,
        finishedAt: sevenHoursAgo,
        status: 'done'
      }),
      // This agent is within the window
      makeAgent({
        id: 'agent-recent',
        startedAt: new Date(now - 1 * 3600 * 1000).toISOString(),
        status: 'running'
      })
    ]

    const { container } = render(<AgentTimeline {...defaultProps} agents={agents} />)
    const bars = container.querySelectorAll('.timeline-bar')
    // Only one bar should be rendered
    expect(bars.length).toBe(1)
  })

  it('renders running agent with running status class', () => {
    const now = Date.now()
    const oneHourAgo = new Date(now - 1 * 3600 * 1000).toISOString()

    const agents = [
      makeAgent({ id: 'agent-running', startedAt: oneHourAgo, finishedAt: null, status: 'running' })
    ]

    const { container } = render(<AgentTimeline {...defaultProps} agents={agents} />)
    const bar = container.querySelector('.timeline-bar--running')
    expect(bar).toBeInTheDocument()
  })

  it('renders done agent with done status class', () => {
    const now = Date.now()
    const twoHoursAgo = new Date(now - 2 * 3600 * 1000).toISOString()
    const oneHourAgo = new Date(now - 1 * 3600 * 1000).toISOString()

    const agents = [
      makeAgent({
        id: 'agent-done',
        startedAt: twoHoursAgo,
        finishedAt: oneHourAgo,
        status: 'done'
      })
    ]

    const { container } = render(<AgentTimeline {...defaultProps} agents={agents} />)
    const bar = container.querySelector('.timeline-bar--done')
    expect(bar).toBeInTheDocument()
  })

  it('renders failed agent with failed status class', () => {
    const now = Date.now()
    const twoHoursAgo = new Date(now - 2 * 3600 * 1000).toISOString()
    const oneHourAgo = new Date(now - 1 * 3600 * 1000).toISOString()

    const agents = [
      makeAgent({
        id: 'agent-failed',
        startedAt: twoHoursAgo,
        finishedAt: oneHourAgo,
        status: 'failed'
      })
    ]

    const { container } = render(<AgentTimeline {...defaultProps} agents={agents} />)
    const bar = container.querySelector('.timeline-bar--failed')
    expect(bar).toBeInTheDocument()
  })

  it('renders cancelled agent with cancelled status class', () => {
    const now = Date.now()
    const twoHoursAgo = new Date(now - 2 * 3600 * 1000).toISOString()
    const oneHourAgo = new Date(now - 1 * 3600 * 1000).toISOString()

    const agents = [
      makeAgent({
        id: 'agent-cancelled',
        startedAt: twoHoursAgo,
        finishedAt: oneHourAgo,
        status: 'cancelled'
      })
    ]

    const { container } = render(<AgentTimeline {...defaultProps} agents={agents} />)
    const bar = container.querySelector('.timeline-bar--cancelled')
    expect(bar).toBeInTheDocument()
  })

  it('calls onSelectAgent when bar is clicked', async () => {
    const user = userEvent.setup()
    const onSelectAgent = vi.fn()
    const now = Date.now()
    const oneHourAgo = new Date(now - 1 * 3600 * 1000).toISOString()

    const agents = [makeAgent({ id: 'agent-1', startedAt: oneHourAgo, status: 'running' })]

    const { container } = render(
      <AgentTimeline {...defaultProps} agents={agents} onSelectAgent={onSelectAgent} />
    )
    const bar = container.querySelector('.timeline-bar')
    expect(bar).toBeInTheDocument()

    if (bar) {
      await user.click(bar)
      expect(onSelectAgent).toHaveBeenCalledWith('agent-1')
    }
  })

  it('renders time axis labels', () => {
    const { container } = render(<AgentTimeline {...defaultProps} />)
    // There should be time labels rendered
    const labels = container.querySelectorAll('[style*="position: absolute"]')
    expect(labels.length).toBeGreaterThan(0)
  })

  it('handles empty agents array', () => {
    const { container } = render(<AgentTimeline {...defaultProps} agents={[]} />)
    const timeline = container.querySelector('.agent-timeline')
    expect(timeline).toBeInTheDocument()
    const bars = container.querySelectorAll('.timeline-bar')
    expect(bars.length).toBe(0)
  })

  it('renders multiple agents with different statuses', () => {
    const now = Date.now()
    const agents = [
      makeAgent({
        id: 'agent-1',
        startedAt: new Date(now - 5 * 3600 * 1000).toISOString(),
        finishedAt: new Date(now - 4 * 3600 * 1000).toISOString(),
        status: 'done'
      }),
      makeAgent({
        id: 'agent-2',
        startedAt: new Date(now - 3 * 3600 * 1000).toISOString(),
        finishedAt: new Date(now - 2 * 3600 * 1000).toISOString(),
        status: 'failed'
      }),
      makeAgent({
        id: 'agent-3',
        startedAt: new Date(now - 1 * 3600 * 1000).toISOString(),
        status: 'running'
      })
    ]

    const { container } = render(<AgentTimeline {...defaultProps} agents={agents} />)
    const bars = container.querySelectorAll('.timeline-bar')
    expect(bars.length).toBe(3)

    expect(container.querySelector('.timeline-bar--done')).toBeInTheDocument()
    expect(container.querySelector('.timeline-bar--failed')).toBeInTheDocument()
    expect(container.querySelector('.timeline-bar--running')).toBeInTheDocument()
  })
})
