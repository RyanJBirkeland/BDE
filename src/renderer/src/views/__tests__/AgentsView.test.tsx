/**
 * AgentsView — covers the v2Agents=true path that ships by default.
 * Mocks the heavy children so we can verify the three-pane layout renders
 * and reacts to selection/launchpad transitions without bringing in the full
 * agent SDK and event-streaming machinery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { nowIso } from '../../../../shared/time'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...rest }: any) => <div {...rest}>{children}</div>
  },
  useReducedMotion: () => false
}))

vi.mock('../../lib/motion', () => ({
  VARIANTS: { fadeIn: {} },
  SPRINGS: { snappy: {} },
  REDUCED_TRANSITION: {},
  useReducedMotion: () => false
}))

const mockAgentHistoryState = {
  agents: [] as any[],
  fetched: false,
  fetchError: null as string | null,
  fetchAgents: vi.fn().mockResolvedValue(undefined),
  selectAgent: vi.fn(),
  displayedCount: 30,
  hasMore: false,
  loadMore: vi.fn()
}

vi.mock('../../stores/agentHistory', () => ({
  useAgentHistoryStore: vi.fn((selector: any) => selector(mockAgentHistoryState))
}))

const mockAgentEventsState = {
  init: vi.fn(() => vi.fn()),
  loadHistory: vi.fn().mockResolvedValue(undefined),
  events: {} as Record<string, unknown[]>,
  clear: vi.fn()
}

vi.mock('../../stores/agentEvents', () => ({
  useAgentEventsStore: Object.assign(
    vi.fn((selector: any) => selector(mockAgentEventsState)),
    { getState: () => mockAgentEventsState }
  ),
  useAgentEvents: vi.fn(() => [])
}))

vi.mock('../../stores/panelLayout', () => ({
  usePanelLayoutStore: vi.fn((selector: any) =>
    selector({ activeView: 'agents', setView: vi.fn() })
  )
}))

vi.mock('../../stores/toasts', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

vi.mock('../../hooks/useAgentViewLifecycle', () => ({
  useAgentViewLifecycle: vi.fn()
}))

vi.mock('../../hooks/useAgentViewCommands', () => ({
  useAgentViewCommands: vi.fn()
}))

vi.mock('../../hooks/useAgentSlashCommands', () => ({
  useAgentSlashCommands: () => ({ handleCommand: vi.fn() })
}))

vi.mock('../../adapters/attachments', () => ({
  buildLocalAgentMessage: (msg: string) => msg
}))

vi.mock('../../components/agents/AgentList', () => ({
  AgentList: ({ agents, onSelect }: any) => (
    <div data-testid="agent-list">
      {agents.map((a: any) => (
        <button key={a.id} data-testid={`agent-${a.id}`} onClick={() => onSelect(a.id)}>
          {a.id}
        </button>
      ))}
    </div>
  )
}))

vi.mock('../../components/agents/AgentConsole', () => ({
  AgentConsole: ({ agentId }: any) => <div data-testid="agent-console">Console: {agentId}</div>
}))

vi.mock('../../components/agents/AgentLaunchpad', () => ({
  AgentLaunchpad: () => <div data-testid="agent-launchpad">Launchpad</div>
}))

vi.mock('../../components/agents/FleetGlance', () => ({
  FleetGlance: ({ agents }: any) => (
    <div data-testid="fleet-glance">Glance: {agents.length} agents</div>
  )
}))

vi.mock('../../components/agents/AgentInspector', () => ({
  AgentInspector: ({ agent }: any) => (
    <div data-testid="agent-inspector">Inspector: {agent?.id}</div>
  )
}))

vi.mock('../../components/ui/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: any) => <>{children}</>
}))

import { AgentsView } from '../AgentsView'

describe('AgentsView (via AgentsView dispatcher)', () => {
  beforeEach(() => {
    mockAgentHistoryState.agents = []
    mockAgentHistoryState.fetched = true
    mockAgentHistoryState.fetchError = null
    vi.clearAllMocks()
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1440
    })
  })

  it('renders without crashing when v2Agents=true', () => {
    const { container } = render(<AgentsView />)
    expect(container.firstChild).not.toBeNull()
  })

  it('renders the agent list panel', () => {
    render(<AgentsView />)
    expect(screen.getByTestId('agent-list')).toBeInTheDocument()
  })

  it('shows the launchpad when no agents have been spawned yet', () => {
    mockAgentHistoryState.agents = []
    render(<AgentsView />)
    expect(screen.getByTestId('agent-launchpad')).toBeInTheDocument()
  })

  it('shows the AgentConsole with the selected agent id once an agent is picked', () => {
    mockAgentHistoryState.agents = [
      { id: 'agent-1', startedAt: nowIso(), status: 'running' },
      { id: 'agent-2', startedAt: nowIso(), status: 'complete' }
    ]
    render(<AgentsView />)
    // The first render auto-falls-back to agents[0] for activeId
    expect(screen.getByTestId('agent-console')).toHaveTextContent('agent-1')
    fireEvent.click(screen.getByTestId('agent-agent-2'))
    expect(screen.getByTestId('agent-console')).toHaveTextContent('agent-2')
  })

  it('renders the inspector pane in console mode at wide viewports', () => {
    mockAgentHistoryState.agents = [{ id: 'agent-1', startedAt: nowIso(), status: 'running' }]
    render(<AgentsView />)
    expect(screen.getByTestId('agent-inspector')).toBeInTheDocument()
  })
})
