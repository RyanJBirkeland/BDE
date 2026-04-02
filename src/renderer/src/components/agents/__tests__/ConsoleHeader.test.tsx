import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ConsoleHeader } from '../ConsoleHeader'
import type { AgentMeta, AgentEvent } from '../../../../../shared/types'

// Mock terminal store
vi.mock('../../../stores/terminal', () => ({
  useTerminalStore: {
    getState: vi.fn(() => ({ addTab: vi.fn() }))
  }
}))

vi.mock('../../../stores/toasts', () => ({
  toast: { error: vi.fn(), success: vi.fn() }
}))

// Mock window.api
Object.defineProperty(window, 'api', {
  value: {
    killAgent: vi.fn().mockResolvedValue(undefined),
    tailAgentLog: vi.fn().mockResolvedValue({ content: 'log content', fromByte: 0 })
  },
  writable: true,
  configurable: true
})

// Mock clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
  configurable: true
})

const baseAgent: AgentMeta = {
  id: 'agent-1',
  pid: 1234,
  bin: 'claude',
  model: 'opus',
  repo: 'BDE',
  repoPath: '/repo/bde',
  task: 'Fix critical bug',
  startedAt: new Date(Date.now() - 120000).toISOString(), // 2 min ago
  finishedAt: null,
  exitCode: null,
  status: 'running',
  logPath: '/tmp/log.txt',
  source: 'bde',
  costUsd: null,
  tokensIn: null,
  tokensOut: null,
  sprintTaskId: null
}

describe('ConsoleHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders agent task name', () => {
    render(<ConsoleHeader agent={baseAgent} events={[]} />)
    expect(screen.getByText('Fix critical bug')).toBeInTheDocument()
  })

  it('renders model badge', () => {
    render(<ConsoleHeader agent={baseAgent} events={[]} />)
    expect(screen.getByText('opus')).toBeInTheDocument()
  })

  it('shows Stop button when agent is running', () => {
    render(<ConsoleHeader agent={baseAgent} events={[]} />)
    expect(screen.getByLabelText('Stop agent')).toBeInTheDocument()
  })

  it('hides Stop button when agent is not running', () => {
    const doneAgent = { ...baseAgent, status: 'done' as const, finishedAt: new Date().toISOString(), exitCode: 0 }
    render(<ConsoleHeader agent={doneAgent} events={[]} />)
    expect(screen.queryByLabelText('Stop agent')).not.toBeInTheDocument()
  })

  it('renders Open terminal button', () => {
    render(<ConsoleHeader agent={baseAgent} events={[]} />)
    expect(screen.getByLabelText('Open terminal')).toBeInTheDocument()
  })

  it('renders Copy log button', () => {
    render(<ConsoleHeader agent={baseAgent} events={[]} />)
    expect(screen.getByLabelText('Copy log')).toBeInTheDocument()
  })

  // ---------- Branch coverage: model accent ----------

  it('assigns purple accent for opus model', () => {
    render(<ConsoleHeader agent={{ ...baseAgent, model: 'claude-opus-4' }} events={[]} />)
    expect(screen.getByText('claude-opus-4')).toBeInTheDocument()
  })

  it('assigns cyan accent for sonnet model', () => {
    render(<ConsoleHeader agent={{ ...baseAgent, model: 'sonnet-3.5' }} events={[]} />)
    expect(screen.getByText('sonnet-3.5')).toBeInTheDocument()
  })

  it('assigns pink accent for haiku model', () => {
    render(<ConsoleHeader agent={{ ...baseAgent, model: 'haiku-3' }} events={[]} />)
    expect(screen.getByText('haiku-3')).toBeInTheDocument()
  })

  it('assigns blue accent for unknown model', () => {
    render(<ConsoleHeader agent={{ ...baseAgent, model: 'gpt-4' }} events={[]} />)
    expect(screen.getByText('gpt-4')).toBeInTheDocument()
  })

  // ---------- Branch coverage: duration format ----------

  it('formats duration in seconds for short runs', () => {
    const recentAgent = {
      ...baseAgent,
      startedAt: new Date(Date.now() - 30000).toISOString()
    }
    render(<ConsoleHeader agent={recentAgent} events={[]} />)
    expect(screen.getByText(/30s/)).toBeInTheDocument()
  })

  it('formats duration with minutes', () => {
    const minuteAgent = {
      ...baseAgent,
      startedAt: new Date(Date.now() - 150000).toISOString() // 2.5 min
    }
    render(<ConsoleHeader agent={minuteAgent} events={[]} />)
    expect(screen.getByText(/2m/)).toBeInTheDocument()
  })

  it('formats duration with hours', () => {
    const hourAgent = {
      ...baseAgent,
      startedAt: new Date(Date.now() - 3700000).toISOString(), // ~1h
      finishedAt: new Date().toISOString(),
      status: 'done' as const
    }
    render(<ConsoleHeader agent={hourAgent} events={[]} />)
    expect(screen.getByText(/1h/)).toBeInTheDocument()
  })

  // ---------- Branch coverage: cost display ----------

  it('shows cost when present in completed event', () => {
    const events: AgentEvent[] = [
      { type: 'agent:completed', exitCode: 0, costUsd: 0.1234, tokensIn: 0, tokensOut: 0, durationMs: 0, timestamp: Date.now() }
    ]
    render(<ConsoleHeader agent={baseAgent} events={events} />)
    expect(screen.getByText('$0.1234')).toBeInTheDocument()
  })

  it('shows cost from agent meta when no completed event', () => {
    const agentWithCost = { ...baseAgent, costUsd: 0.5678 }
    render(<ConsoleHeader agent={agentWithCost} events={[]} />)
    expect(screen.getByText('$0.5678')).toBeInTheDocument()
  })

  it('does not show cost when neither event nor agent has cost', () => {
    render(<ConsoleHeader agent={baseAgent} events={[]} />)
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  // ---------- Branch coverage: action handlers ----------

  it('copies log on copy button click', async () => {
    const { toast } = await import('../../../stores/toasts')
    render(<ConsoleHeader agent={baseAgent} events={[]} />)
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Copy log'))
    })
    expect(window.api.tailAgentLog).toHaveBeenCalled()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('log content')
    expect(toast.success).toHaveBeenCalledWith('Log copied to clipboard')
  })

  it('shows error toast when stop fails', async () => {
    vi.mocked(window.api.killAgent).mockRejectedValue(new Error('kill failed'))
    const { toast } = await import('../../../stores/toasts')
    render(<ConsoleHeader agent={baseAgent} events={[]} />)
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Stop agent'))
    })
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('kill failed'))
  })

  it('shows error toast when copy log fails', async () => {
    vi.mocked(window.api.tailAgentLog).mockRejectedValue(new Error('log read failed'))
    const { toast } = await import('../../../stores/toasts')
    render(<ConsoleHeader agent={baseAgent} events={[]} />)
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Copy log'))
    })
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('log read failed'))
  })
})
