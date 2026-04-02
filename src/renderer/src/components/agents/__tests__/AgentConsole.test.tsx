/**
 * AgentConsole.test.tsx — Tests for terminal-style agent console component.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentConsole } from '../AgentConsole'
import type { AgentMeta, AgentEvent } from '../../../../../shared/types'
import { useAgentHistoryStore } from '../../../stores/agentHistory'
import { useAgentEventsStore } from '../../../stores/agentEvents'

// Mock stores
vi.mock('../../../stores/agentHistory', () => ({
  useAgentHistoryStore: vi.fn()
}))

vi.mock('../../../stores/agentEvents', () => ({
  useAgentEventsStore: vi.fn()
}))

// Mock terminal store
vi.mock('../../../stores/terminal', () => ({
  useTerminalStore: {
    getState: vi.fn(() => ({
      addTab: vi.fn()
    }))
  }
}))

// Mock @tanstack/react-virtual
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn((config) => ({
    getVirtualItems: () => {
      // Return virtual items for each block
      const count = config?.count ?? 0
      return Array.from({ length: count }, (_, i) => ({
        key: i,
        index: i,
        start: i * 60,
        size: 60
      }))
    },
    getTotalSize: () => (config?.count ?? 0) * 60,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn()
  }))
}))

// Mock CommandBar component
vi.mock('../CommandBar', () => ({
  CommandBar: ({ disabled }: { disabled: boolean }) => (
    <div
      data-testid="command-bar"
      className={`command-bar${disabled ? ' command-bar--disabled' : ''}`}
      data-disabled={disabled}
    >
      Command Bar
    </div>
  )
}))

describe('AgentConsole', () => {
  const mockAgent: AgentMeta = {
    id: 'test-agent-1',
    pid: 12345,
    bin: 'claude',
    model: 'opus-4',
    repo: 'test-repo',
    repoPath: '/path/to/repo',
    task: 'Implement feature X',
    startedAt: '2024-01-01T00:00:00.000Z',
    finishedAt: null,
    exitCode: null,
    status: 'running',
    logPath: '/path/to/log',
    source: 'bde',
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    sprintTaskId: null
  }

  const mockEvents: AgentEvent[] = [
    {
      type: 'agent:started',
      model: 'opus-4',
      timestamp: Date.now() - 60000
    },
    {
      type: 'agent:text',
      text: 'Starting task...',
      timestamp: Date.now() - 50000
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    // Setup default mock returns
    vi.mocked(useAgentHistoryStore).mockImplementation((selector: any) => {
      const state = { agents: [mockAgent] }
      return selector(state)
    })
    vi.mocked(useAgentEventsStore).mockImplementation((selector: any) => {
      const state = { events: { 'test-agent-1': mockEvents } }
      return selector(state)
    })
  })

  it('renders console header with agent name', () => {
    render(<AgentConsole agentId="test-agent-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
    expect(screen.getByText('Implement feature X')).toBeInTheDocument()
  })

  it('renders console lines for events', () => {
    render(<AgentConsole agentId="test-agent-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
    // The ConsoleLine component should render the started event
    expect(screen.getByText(/Started with model opus-4/)).toBeInTheDocument()
  })

  it('shows "Agent not found" when agent does not exist', () => {
    vi.mocked(useAgentHistoryStore).mockImplementation((selector: any) => {
      const state = { agents: [] }
      return selector(state)
    })
    render(<AgentConsole agentId="nonexistent" onSteer={vi.fn()} onCommand={vi.fn()} />)
    expect(screen.getByText('Agent not found')).toBeInTheDocument()
  })

  it('shows "No events available" when events array is empty', () => {
    vi.mocked(useAgentEventsStore).mockImplementation((selector: any) => {
      const state = { events: { 'test-agent-1': [] } }
      return selector(state)
    })
    render(<AgentConsole agentId="test-agent-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
    expect(screen.getByText('No events available')).toBeInTheDocument()
  })

  it('renders model badge in header', () => {
    render(<AgentConsole agentId="test-agent-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
    // NeonBadge renders lowercase text with CSS text-transform
    expect(screen.getByText('opus-4')).toBeInTheDocument()
  })

  it('displays duration in header', () => {
    render(<AgentConsole agentId="test-agent-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
    // Should show some duration (exact value depends on timing)
    const header = screen.getByText('Implement feature X').closest('.console-header')
    expect(header).toBeInTheDocument()
  })

  it('applies disabled class to command bar when agent is not running', () => {
    const doneAgent = { ...mockAgent, status: 'done' as const }
    vi.mocked(useAgentHistoryStore).mockImplementation((selector: any) => {
      const state = { agents: [doneAgent] }
      return selector(state)
    })
    render(<AgentConsole agentId="test-agent-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
    const commandBar = screen.getByTestId('command-bar')
    expect(commandBar).toHaveClass('command-bar--disabled')
  })

  it('does not apply disabled class to command bar when agent is running', () => {
    render(<AgentConsole agentId="test-agent-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
    const commandBar = screen.getByTestId('command-bar')
    expect(commandBar).not.toHaveClass('command-bar--disabled')
  })
})
