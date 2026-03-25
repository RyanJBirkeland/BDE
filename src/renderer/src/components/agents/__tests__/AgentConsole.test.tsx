import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentConsole } from '../AgentConsole'
import type { AgentMeta, AgentEvent } from '../../../../../shared/types'

// Mock stores
vi.mock('../../../stores/agentEvents', () => ({
  useAgentEventsStore: vi.fn((selector) => {
    const mockState = {
      events: {
        'agent-1': [
          { type: 'agent:started', model: 'claude-sonnet-4-6', timestamp: Date.now() },
          { type: 'agent:text', text: 'Processing your request', timestamp: Date.now() },
        ] as AgentEvent[],
      },
    }
    return selector(mockState)
  }),
}))

vi.mock('../../../stores/agentHistory', () => ({
  useAgentHistoryStore: vi.fn((selector) => {
    const mockAgent: AgentMeta = {
      id: 'agent-1',
      pid: 12345,
      bin: 'claude',
      model: 'claude-sonnet-4-6',
      repo: 'bde',
      repoPath: '/Users/test/bde',
      task: 'Fix bug in authentication',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      status: 'running',
      logPath: '/logs/agent-1.log',
      source: 'bde',
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null,
    }
    const mockState = {
      agents: [mockAgent],
    }
    return selector(mockState)
  }),
}))

vi.mock('../../../stores/terminal', () => ({
  useTerminalStore: {
    getState: vi.fn(() => ({
      addTab: vi.fn(),
    })),
  },
}))

// Mock ConsoleHeader
vi.mock('../ConsoleHeader', () => ({
  ConsoleHeader: ({ agent }: { agent: AgentMeta }) => (
    <div data-testid="console-header">
      Header: {agent.task}
    </div>
  ),
}))

// Mock ConsoleLine
vi.mock('../ConsoleLine', () => ({
  ConsoleLine: ({ block }: { block: { type: string } }) => (
    <div data-testid="console-line">
      Line: {block.type}
    </div>
  ),
}))

// Stub virtualizer
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        key: i,
        index: i,
        start: i * 40,
        size: 40,
      })),
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
  }),
}))

// Mock window.api
global.window = {
  ...global.window,
  api: {
    agents: {
      readLog: vi.fn(() => Promise.resolve({ content: 'log content', nextByte: 1000 })),
      stop: vi.fn(() => Promise.resolve()),
    },
  },
} as any

describe('AgentConsole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders console header with agent name', () => {
    render(<AgentConsole agentId="agent-1" onSteer={vi.fn()} />)
    expect(screen.getByTestId('console-header')).toBeInTheDocument()
    expect(screen.getByText(/Fix bug in authentication/)).toBeInTheDocument()
  })

  it('renders console lines for events', () => {
    render(<AgentConsole agentId="agent-1" onSteer={vi.fn()} />)
    const lines = screen.getAllByTestId('console-line')
    expect(lines.length).toBeGreaterThan(0)
  })

  it('renders "Agent not found" when agent does not exist', () => {
    // Mock the store to return no agents
    vi.mocked(vi.mocked(require('../../../stores/agentHistory').useAgentHistoryStore)).mockImplementation(
      (selector: any) => {
        const mockState = { agents: [] }
        return selector(mockState)
      }
    )

    render(<AgentConsole agentId="nonexistent" onSteer={vi.fn()} />)
    expect(screen.getByText('Agent not found')).toBeInTheDocument()
  })

  it('renders command bar placeholder', () => {
    render(<AgentConsole agentId="agent-1" onSteer={vi.fn()} />)
    expect(screen.getByPlaceholderText(/Command bar/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Command bar/)).toBeDisabled()
  })

  it('renders console body with virtual scrolling', () => {
    const { container } = render(<AgentConsole agentId="agent-1" onSteer={vi.fn()} />)
    const consoleBody = container.querySelector('.console-body')
    expect(consoleBody).toBeInTheDocument()
  })
})
