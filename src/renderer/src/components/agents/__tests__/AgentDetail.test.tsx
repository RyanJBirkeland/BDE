import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentDetail } from '../AgentDetail'
import type { AgentMeta, AgentEvent } from '../../../../../shared/types'
import { useTerminalStore } from '../../../stores/terminal'

// Mock ChatRenderer and SteerInput to simplify tests
vi.mock('../ChatRenderer', () => ({
  ChatRenderer: ({ events }: { events: AgentEvent[] }) => (
    <div data-testid="chat-renderer">Chat events: {events.length}</div>
  )
}))

vi.mock('../SteerInput', () => ({
  SteerInput: ({ agentId, onSend }: { agentId: string; onSend: (msg: string) => void }) => (
    <div data-testid="steer-input" data-agent-id={agentId}>
      <button onClick={() => onSend('test message')}>Send</button>
    </div>
  )
}))

// Mock terminal store
vi.mock('../../../stores/terminal', () => ({
  useTerminalStore: {
    getState: vi.fn(() => ({
      addTab: vi.fn()
    }))
  }
}))

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

const completedEvent: AgentEvent = {
  type: 'agent:completed',
  exitCode: 0,
  costUsd: 0.0042,
  tokensIn: 1000,
  tokensOut: 500,
  durationMs: 5000,
  timestamp: Date.now()
}

describe('AgentDetail', () => {
  const defaultProps = {
    onSteer: vi.fn(),
    events: []
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders agent task name in header', () => {
    const agent = makeAgent({ task: 'Build the auth module' })
    render(<AgentDetail {...defaultProps} agent={agent} />)
    expect(screen.getByText('Build the auth module')).toBeInTheDocument()
  })

  it('renders agent model', () => {
    const agent = makeAgent({ model: 'claude-opus-4' })
    render(<AgentDetail {...defaultProps} agent={agent} />)
    expect(screen.getByText('claude-opus-4')).toBeInTheDocument()
  })

  it('renders running status badge', () => {
    const agent = makeAgent({ status: 'running' })
    render(<AgentDetail {...defaultProps} agent={agent} />)
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('renders done status badge', () => {
    const agent = makeAgent({ status: 'done', finishedAt: new Date().toISOString() })
    render(<AgentDetail {...defaultProps} agent={agent} />)
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('renders failed status badge', () => {
    const agent = makeAgent({ status: 'failed', finishedAt: new Date().toISOString() })
    render(<AgentDetail {...defaultProps} agent={agent} />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('renders cancelled status badge', () => {
    const agent = makeAgent({ status: 'cancelled', finishedAt: new Date().toISOString() })
    render(<AgentDetail {...defaultProps} agent={agent} />)
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('renders unknown status for unrecognized status', () => {
    // Cast to bypass type check
    const agent = makeAgent({ status: 'unknown' as AgentMeta['status'] })
    render(<AgentDetail {...defaultProps} agent={agent} />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('renders repo name', () => {
    const agent = makeAgent({ repo: 'my-repo' })
    render(<AgentDetail {...defaultProps} agent={agent} />)
    expect(screen.getByText('my-repo')).toBeInTheDocument()
  })

  it('renders ChatRenderer when events are provided', () => {
    const agent = makeAgent()
    const events: AgentEvent[] = [{ type: 'agent:text', text: 'Hello', timestamp: Date.now() }]
    render(<AgentDetail {...defaultProps} agent={agent} events={events} />)
    expect(screen.getByTestId('chat-renderer')).toBeInTheDocument()
  })

  it('shows LogFallback loading state when events are empty', async () => {
    const agent = makeAgent({ logPath: '/tmp/agent.log' })
    render(<AgentDetail {...defaultProps} agent={agent} events={[]} />)
    // Loading log... appears while the promise is pending
    expect(screen.getByText('Loading log...')).toBeInTheDocument()
  })

  it('shows LogFallback empty message when log is empty', async () => {
    vi.mocked(window.api.tailAgentLog).mockResolvedValue({ content: '', nextByte: 0 })
    const agent = makeAgent({ logPath: '/tmp/agent.log' })
    render(<AgentDetail {...defaultProps} agent={agent} events={[]} />)
    await waitFor(() => {
      expect(screen.getByText('No output available for this agent.')).toBeInTheDocument()
    })
  })

  it('shows log content when log has data', async () => {
    vi.mocked(window.api.tailAgentLog).mockResolvedValue({
      content: 'Agent output here',
      nextByte: 17
    })
    const agent = makeAgent({ logPath: '/tmp/agent.log' })
    render(<AgentDetail {...defaultProps} agent={agent} events={[]} />)
    await waitFor(() => {
      expect(screen.getByText('Agent output here')).toBeInTheDocument()
    })
  })

  it('shows SteerInput when agent is running', () => {
    const agent = makeAgent({ status: 'running' })
    const events: AgentEvent[] = [{ type: 'agent:text', text: 'Working...', timestamp: Date.now() }]
    render(<AgentDetail {...defaultProps} agent={agent} events={events} />)
    expect(screen.getByTestId('steer-input')).toBeInTheDocument()
  })

  it('does not show SteerInput when agent is done', () => {
    const agent = makeAgent({ status: 'done', finishedAt: new Date().toISOString() })
    const events: AgentEvent[] = [{ type: 'agent:text', text: 'Done', timestamp: Date.now() }]
    render(<AgentDetail {...defaultProps} agent={agent} events={events} />)
    expect(screen.queryByTestId('steer-input')).not.toBeInTheDocument()
  })

  it('does not show SteerInput when agent is failed', () => {
    const agent = makeAgent({ status: 'failed', finishedAt: new Date().toISOString() })
    const events: AgentEvent[] = [{ type: 'agent:text', text: 'Error', timestamp: Date.now() }]
    render(<AgentDetail {...defaultProps} agent={agent} events={events} />)
    expect(screen.queryByTestId('steer-input')).not.toBeInTheDocument()
  })

  it('calls onSteer when message is sent via SteerInput', async () => {
    const onSteer = vi.fn()
    const agent = makeAgent({ status: 'running' })
    const events: AgentEvent[] = [{ type: 'agent:text', text: 'Working...', timestamp: Date.now() }]
    render(<AgentDetail agent={agent} events={events} onSteer={onSteer} />)
    const sendButton = screen.getByRole('button', { name: 'Send' })
    sendButton.click()
    expect(onSteer).toHaveBeenCalledWith('test message')
  })

  it('shows cost info when completed event is present', () => {
    const agent = makeAgent({ status: 'done', finishedAt: new Date().toISOString() })
    const events: AgentEvent[] = [completedEvent]
    render(<AgentDetail {...defaultProps} agent={agent} events={events} />)
    expect(screen.getByText('$0.0042')).toBeInTheDocument()
  })

  it('does not show cost when no completed event', () => {
    const agent = makeAgent({ status: 'running' })
    const events: AgentEvent[] = [{ type: 'agent:text', text: 'Working...', timestamp: Date.now() }]
    render(<AgentDetail {...defaultProps} agent={agent} events={events} />)
    // No dollar sign in the document beyond the model info
    expect(screen.queryByText(/\$0\./)).not.toBeInTheDocument()
  })

  it('truncates long task names at 120 chars', () => {
    const longTask = 'B'.repeat(130)
    const agent = makeAgent({ task: longTask })
    render(<AgentDetail {...defaultProps} agent={agent} events={[]} />)
    expect(screen.getByText('B'.repeat(120))).toBeInTheDocument()
  })

  it('handles log load error gracefully', async () => {
    vi.mocked(window.api.tailAgentLog).mockRejectedValue(new Error('Permission denied'))
    const agent = makeAgent({ logPath: '/tmp/inaccessible.log' })
    render(<AgentDetail {...defaultProps} agent={agent} events={[]} />)
    await waitFor(() => {
      expect(screen.getByText('No output available for this agent.')).toBeInTheDocument()
    })
  })

  it('renders Open Shell button', () => {
    const agent = makeAgent()
    render(<AgentDetail {...defaultProps} agent={agent} events={[]} />)
    const button = screen.getByRole('button', { name: /open shell/i })
    expect(button).toBeInTheDocument()
  })

  it('opens terminal in agent repo directory when Open Shell is clicked', async () => {
    const user = userEvent.setup()
    const mockAddTab = vi.fn()
    vi.mocked(useTerminalStore.getState).mockReturnValue({
      addTab: mockAddTab
    } as never)
    const agent = makeAgent({ repo: 'BDE', repoPath: '/home/user/bde' })
    render(<AgentDetail {...defaultProps} agent={agent} events={[]} />)

    const button = screen.getByRole('button', { name: /open shell/i })
    await user.click(button)

    expect(mockAddTab).toHaveBeenCalledWith(undefined, '/home/user/bde')
  })
})
