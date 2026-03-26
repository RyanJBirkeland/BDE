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
})
