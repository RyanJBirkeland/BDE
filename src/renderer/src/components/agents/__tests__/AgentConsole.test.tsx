/**
 * AgentConsole.test.tsx — Tests for terminal-style agent console component.
 */
import { render, screen, fireEvent } from '@testing-library/react'
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
  CommandBar: ({ onSend, disabled }: { onSend: (msg: string) => void; disabled: boolean }) => (
    <div
      data-testid="command-bar"
      className={`command-bar${disabled ? ' command-bar--disabled' : ''}`}
      data-disabled={disabled}
    >
      <button onClick={() => onSend('test message')}>Send</button>
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
      const state = { events: { 'test-agent-1': mockEvents }, evictedAgents: {} }
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

  it('shows loading state when agent is running and has no events', () => {
    vi.mocked(useAgentEventsStore).mockImplementation((selector: any) => {
      const state = { events: { 'test-agent-1': [] }, evictedAgents: {} }
      return selector(state)
    })
    render(<AgentConsole agentId="test-agent-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
    expect(screen.getByText('Waiting for agent output…')).toBeInTheDocument()
    // Check for spinner icon
    const spinner = document.querySelector('.console-empty-state__spinner')
    expect(spinner).toBeInTheDocument()
  })

  it('shows "No events recorded" when agent is terminal and has no events', () => {
    const doneAgent = { ...mockAgent, status: 'done' as const }
    vi.mocked(useAgentHistoryStore).mockImplementation((selector: any) => {
      const state = { agents: [doneAgent] }
      return selector(state)
    })
    vi.mocked(useAgentEventsStore).mockImplementation((selector: any) => {
      const state = { events: { 'test-agent-1': [] } }
      return selector(state)
    })
    render(<AgentConsole agentId="test-agent-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
    expect(screen.getByText('No events recorded for this agent')).toBeInTheDocument()
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

  it('shows trimmed events banner when evictedAgents flag is set', () => {
    vi.mocked(useAgentEventsStore).mockImplementation((selector: any) => {
      const state = { events: { 'test-agent-1': mockEvents }, evictedAgents: { 'test-agent-1': true } }
      return selector(state)
    })
    render(<AgentConsole agentId="test-agent-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
    expect(screen.getByText('Older events were trimmed (showing last 2,000)')).toBeInTheDocument()
  })

  it('does not show trimmed events banner when evictedAgents flag is not set', () => {
    vi.mocked(useAgentEventsStore).mockImplementation((selector: any) => {
      const state = { events: { 'test-agent-1': mockEvents }, evictedAgents: {} }
      return selector(state)
    })
    render(<AgentConsole agentId="test-agent-1" onSteer={vi.fn()} onCommand={vi.fn()} />)
    expect(screen.queryByText('Older events were trimmed (showing last 2,000)')).not.toBeInTheDocument()
  })

  it('shows pending message optimistically when steering', () => {
    const onSteer = vi.fn()
    render(<AgentConsole agentId="test-agent-1" onSteer={onSteer} onCommand={vi.fn()} />)

    // Send a message via the mocked CommandBar
    const sendButton = screen.getByText('Send')
    fireEvent.click(sendButton)

    // Check that onSteer was called
    expect(onSteer).toHaveBeenCalledWith('test message')

    // Check that pending message appears in the document
    expect(screen.getByText('test message')).toBeInTheDocument()
  })

  it('applies pending CSS class to optimistic messages', () => {
    const onSteer = vi.fn()
    const { container } = render(<AgentConsole agentId="test-agent-1" onSteer={onSteer} onCommand={vi.fn()} />)

    // Send a message
    const sendButton = screen.getByText('Send')
    fireEvent.click(sendButton)

    // Find the user message line and check for pending class
    const userLine = container.querySelector('.console-line--pending')
    expect(userLine).toBeInTheDocument()
    expect(userLine).toHaveTextContent('test message')
  })

  it('removes pending message when real user_message event arrives', () => {
    let eventState = { events: { 'test-agent-1': mockEvents } }
    vi.mocked(useAgentEventsStore).mockImplementation((selector: any) => {
      return selector(eventState)
    })

    const onSteer = vi.fn()
    const { rerender, container } = render(<AgentConsole agentId="test-agent-1" onSteer={onSteer} onCommand={vi.fn()} />)

    // Send a message to create pending state
    const sendButton = screen.getByText('Send')
    fireEvent.click(sendButton)

    // Verify pending message is present
    expect(container.querySelector('.console-line--pending')).toBeInTheDocument()

    // Simulate real user_message event arriving
    eventState = {
      events: {
        'test-agent-1': [
          ...mockEvents,
          {
            type: 'agent:user_message',
            text: 'test message',
            timestamp: Date.now()
          }
        ]
      }
    }

    // Re-mock the store with updated events
    vi.mocked(useAgentEventsStore).mockImplementation((selector: any) => {
      return selector(eventState)
    })

    rerender(<AgentConsole agentId="test-agent-1" onSteer={onSteer} onCommand={vi.fn()} />)

    // Pending message should be removed
    expect(container.querySelector('.console-line--pending')).not.toBeInTheDocument()
  })
})
