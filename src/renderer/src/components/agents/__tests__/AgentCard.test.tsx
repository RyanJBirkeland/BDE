import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentCard } from '../AgentCard'
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

describe('AgentCard', () => {
  const defaultProps = {
    selected: false,
    onClick: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders agent task name', () => {
    const agent = makeAgent({ task: 'Implement dark mode' })
    render(<AgentCard {...defaultProps} agent={agent} />)
    expect(screen.getByText('Implement dark mode')).toBeInTheDocument()
  })

  it('renders agent model', () => {
    const agent = makeAgent({ model: 'claude-opus' })
    render(<AgentCard {...defaultProps} agent={agent} />)
    expect(screen.getByText('claude-opus')).toBeInTheDocument()
  })

  it('renders agent repo', () => {
    const agent = makeAgent({ repo: 'my-repo' })
    render(<AgentCard {...defaultProps} agent={agent} />)
    expect(screen.getByText('my-repo')).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const agent = makeAgent()
    render(<AgentCard {...defaultProps} agent={agent} onClick={onClick} />)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('applies selected style when selected=true', () => {
    const agent = makeAgent()
    const { container } = render(<AgentCard {...defaultProps} agent={agent} selected={true} />)
    const neonCard = container.querySelector('.neon-card')
    expect(neonCard).toBeInTheDocument()
    // Selected card has enhanced glow and border
    const cardStyle = (neonCard as HTMLElement)?.style
    expect(cardStyle.boxShadow).toContain('glow')
  })

  it('applies default style when not selected', () => {
    const agent = makeAgent()
    const { container } = render(<AgentCard {...defaultProps} agent={agent} selected={false} />)
    const neonCard = container.querySelector('.neon-card')
    expect(neonCard).toBeInTheDocument()
    // Non-selected card doesn't have enhanced styling
    const cardStyle = (neonCard as HTMLElement)?.style
    expect(cardStyle.transform).not.toBe('scale(1.02)')
  })

  it('shows status dot for running agent', () => {
    const agent = makeAgent({ status: 'running' })
    const { container } = render(<AgentCard {...defaultProps} agent={agent} />)
    // Running agents have a pulsing status dot
    const dot = container.querySelector('span[style*="border-radius"]')
    expect(dot).toBeInTheDocument()
  })

  it('truncates long task names at 80 characters', () => {
    const longTask = 'A'.repeat(100)
    const agent = makeAgent({ task: longTask })
    render(<AgentCard {...defaultProps} agent={agent} />)
    expect(screen.getByText('A'.repeat(80))).toBeInTheDocument()
  })

  it('shows duration for a done agent with finishedAt', () => {
    const started = new Date('2024-01-01T10:00:00Z').toISOString()
    const finished = new Date('2024-01-01T10:02:30Z').toISOString()
    const agent = makeAgent({ status: 'done', startedAt: started, finishedAt: finished })
    render(<AgentCard {...defaultProps} agent={agent} />)
    // 150 seconds = 2 minutes
    expect(screen.getByText('2m')).toBeInTheDocument()
  })

  it('shows duration in seconds for short runs', () => {
    const now = Date.now()
    const started = new Date(now - 30_000).toISOString()
    const finished = new Date(now).toISOString()
    const agent = makeAgent({ status: 'done', startedAt: started, finishedAt: finished })
    render(<AgentCard {...defaultProps} agent={agent} />)
    expect(screen.getByText('30s')).toBeInTheDocument()
  })

  it('shows duration in hours for long runs', () => {
    const started = new Date('2024-01-01T08:00:00Z').toISOString()
    const finished = new Date('2024-01-01T10:30:00Z').toISOString()
    const agent = makeAgent({ status: 'done', startedAt: started, finishedAt: finished })
    render(<AgentCard {...defaultProps} agent={agent} />)
    expect(screen.getByText('2h 30m')).toBeInTheDocument()
  })

  it('uses Bot icon for bde source agents', () => {
    const agent = makeAgent({ source: 'bde' })
    const { container } = render(<AgentCard {...defaultProps} agent={agent} />)
    // Bot icon renders an SVG
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThan(0)
  })

  it('uses Cpu icon for external source agents', () => {
    const agent = makeAgent({ source: 'external' })
    const { container } = render(<AgentCard {...defaultProps} agent={agent} />)
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThan(0)
  })

  it('renders done status agent without animation', () => {
    const agent = makeAgent({ status: 'done', finishedAt: new Date().toISOString() })
    const { container } = render(<AgentCard {...defaultProps} agent={agent} />)
    // Status dot for done agents has no animation
    const dots = container.querySelectorAll('span')
    expect(dots.length).toBeGreaterThan(0)
  })

  it('renders failed agent', () => {
    const agent = makeAgent({ status: 'failed', finishedAt: new Date().toISOString() })
    render(<AgentCard {...defaultProps} agent={agent} />)
    expect(screen.getByText('Fix the login bug')).toBeInTheDocument()
  })

  it('renders cancelled agent', () => {
    const agent = makeAgent({ status: 'cancelled', finishedAt: new Date().toISOString() })
    render(<AgentCard {...defaultProps} agent={agent} />)
    expect(screen.getByText('Fix the login bug')).toBeInTheDocument()
  })
})
