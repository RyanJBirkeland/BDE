import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LiveActivityStrip } from '../LiveActivityStrip'
import type { AgentMeta, AgentEvent } from '../../../../../shared/types'

// Mock state for stores
let mockAgents: AgentMeta[] = []
let mockEvents: Record<string, AgentEvent[]> = {}

// Mock the stores
vi.mock('../../../stores/agentHistory', () => ({
  useAgentHistoryStore: vi.fn((selector) =>
    selector({
      agents: mockAgents,
      selectedId: null,
      loading: false,
      logContent: '',
      logNextByte: 0,
      logTrimmedLines: 0,
      fetchAgents: vi.fn(),
      selectAgent: vi.fn(),
      clearSelection: vi.fn(),
      startLogPolling: vi.fn(),
      stopLogPolling: vi.fn(),
      importExternal: vi.fn()
    })
  )
}))

vi.mock('../../../stores/agentEvents', () => ({
  useAgentEventsStore: vi.fn((selector) =>
    selector({
      events: mockEvents,
      init: vi.fn(),
      loadHistory: vi.fn(),
      clear: vi.fn()
    })
  )
}))

describe('LiveActivityStrip', () => {
  const mockOnSelectAgent = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockAgents = []
    mockEvents = {}
  })

  it('shows "No agents active" when there are no running agents', () => {
    mockAgents = []
    mockEvents = {}

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)

    expect(screen.getByText('No agents active')).toBeInTheDocument()
    expect(screen.getByText('Spawn Agent')).toBeInTheDocument()
  })

  it('renders agent pills for running agents', () => {
    const runningAgent: AgentMeta = {
      id: 'agent-1',
      pid: 12345,
      bin: 'claude',
      model: 'opus',
      repo: 'test-repo',
      repoPath: '/path/to/repo',
      task: 'Implement feature X',
      startedAt: '2026-03-25T10:00:00Z',
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

    const doneAgent: AgentMeta = {
      ...runningAgent,
      id: 'agent-2',
      task: 'Fix bug Y',
      status: 'done',
      finishedAt: '2026-03-25T10:30:00Z',
      exitCode: 0
    }

    mockAgents = [runningAgent, doneAgent]
    mockEvents = {
      'agent-1': [
        { type: 'agent:started', model: 'opus', timestamp: Date.now() },
        { type: 'agent:tool_call', tool: 'Read', summary: 'Reading file.ts', timestamp: Date.now() }
      ]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)

    // Should only show the running agent, not the done agent
    expect(screen.getByText('Implement feature X')).toBeInTheDocument()
    expect(screen.getByText('Reading file.ts')).toBeInTheDocument()
    expect(screen.queryByText('Fix bug Y')).not.toBeInTheDocument()
  })

  it('displays current action from latest event', () => {
    const runningAgent: AgentMeta = {
      id: 'agent-1',
      pid: 12345,
      bin: 'claude',
      model: 'opus',
      repo: 'test-repo',
      repoPath: '/path/to/repo',
      task: 'Test task',
      startedAt: '2026-03-25T10:00:00Z',
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

    mockAgents = [runningAgent]
    mockEvents = {
      'agent-1': [
        { type: 'agent:started', model: 'opus', timestamp: Date.now() },
        { type: 'agent:thinking', tokenCount: 100, timestamp: Date.now() }
      ]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)

    expect(screen.getByText('Thinking…')).toBeInTheDocument()
  })

  // Helper to create a running agent
  const makeAgent = (id = 'agent-1'): AgentMeta => ({
    id,
    pid: 12345,
    bin: 'claude',
    model: 'opus',
    repo: 'test-repo',
    repoPath: '/path/to/repo',
    task: 'Test task',
    startedAt: '2026-03-25T10:00:00Z',
    finishedAt: null,
    exitCode: null,
    status: 'running',
    logPath: '/path/to/log',
    source: 'bde',
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    sprintTaskId: null
  })

  it('shows "Starting…" when no events exist for agent', () => {
    mockAgents = [makeAgent()]
    mockEvents = {}

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)
    expect(screen.getByText('Starting…')).toBeInTheDocument()
  })

  it('shows started message with model name', () => {
    mockAgents = [makeAgent()]
    mockEvents = {
      'agent-1': [{ type: 'agent:started', model: 'sonnet', timestamp: Date.now() }]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)
    expect(screen.getByText('Started with sonnet')).toBeInTheDocument()
  })

  it('shows tool name when tool_call has no summary', () => {
    mockAgents = [makeAgent()]
    mockEvents = {
      'agent-1': [{ type: 'agent:tool_call', tool: 'Write', summary: '', timestamp: Date.now() }]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)
    expect(screen.getByText('Calling Write')).toBeInTheDocument()
  })

  it('shows tool_result summary', () => {
    mockAgents = [makeAgent()]
    mockEvents = {
      'agent-1': [{ type: 'agent:tool_result', tool: 'Read', success: true, summary: 'Read 50 lines', timestamp: Date.now() }]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)
    expect(screen.getByText('Read 50 lines')).toBeInTheDocument()
  })

  it('shows tool_result fallback when no summary', () => {
    mockAgents = [makeAgent()]
    mockEvents = {
      'agent-1': [{ type: 'agent:tool_result', tool: 'Bash', success: true, summary: '', timestamp: Date.now() }]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)
    expect(screen.getByText('Bash completed')).toBeInTheDocument()
  })

  it('shows text event content', () => {
    mockAgents = [makeAgent()]
    mockEvents = {
      'agent-1': [{ type: 'agent:text', text: 'Analyzing code', timestamp: Date.now() }]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)
    expect(screen.getByText('Analyzing code')).toBeInTheDocument()
  })

  it('shows user_message event', () => {
    mockAgents = [makeAgent()]
    mockEvents = {
      'agent-1': [{ type: 'agent:user_message', text: 'focus on tests', timestamp: Date.now() }]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)
    expect(screen.getByText('User message')).toBeInTheDocument()
  })

  it('shows rate_limited event with retry delay', () => {
    mockAgents = [makeAgent()]
    mockEvents = {
      'agent-1': [{ type: 'agent:rate_limited', retryDelayMs: 30000, attempt: 1, timestamp: Date.now() }]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)
    expect(screen.getByText('Rate limited (retry in 30s)')).toBeInTheDocument()
  })

  it('shows error event message', () => {
    mockAgents = [makeAgent()]
    mockEvents = {
      'agent-1': [{ type: 'agent:error', message: 'Token expired', timestamp: Date.now() }]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)
    expect(screen.getByText('Token expired')).toBeInTheDocument()
  })

  it('shows completed event', () => {
    mockAgents = [makeAgent()]
    mockEvents = {
      'agent-1': [{ type: 'agent:completed', exitCode: 0, costUsd: 0, tokensIn: 0, tokensOut: 0, durationMs: 0, timestamp: Date.now() }]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('shows playground event with filename', () => {
    mockAgents = [makeAgent()]
    mockEvents = {
      'agent-1': [{ type: 'agent:playground', filename: 'test.ts', html: '', sizeBytes: 100, timestamp: Date.now() }]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)
    expect(screen.getByText('Playground: test.ts')).toBeInTheDocument()
  })

  it('shows "Running…" for unknown event types', () => {
    mockAgents = [makeAgent()]
    mockEvents = {
      'agent-1': [{ type: 'agent:unknown_type', timestamp: Date.now() } as any]
    }

    render(<LiveActivityStrip onSelectAgent={mockOnSelectAgent} />)
    expect(screen.getByText('Running…')).toBeInTheDocument()
  })
})
