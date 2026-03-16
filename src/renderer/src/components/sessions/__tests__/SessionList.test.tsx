import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionList } from '../SessionList'
import type { AgentSession, SubAgent } from '../../../stores/sessions'

const FIVE_MINUTES = 5 * 60 * 1000

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    key: 'test-key',
    sessionId: 'sess-1',
    model: 'sonnet',
    displayName: 'Test Session',
    channel: 'cli',
    lastChannel: 'cli',
    updatedAt: Date.now(),
    totalTokens: 1000,
    contextTokens: 500,
    abortedLastRun: false,
    ...overrides,
  }
}

function makeSubAgent(overrides: Partial<SubAgent> = {}): SubAgent {
  return {
    sessionKey: 'sub-1',
    label: 'Sub Agent',
    status: 'running',
    model: 'haiku',
    startedAt: Date.now(),
    _isActive: true,
    ...overrides,
  }
}

// Build mock store state
let mockStoreState = {
  sessions: [] as AgentSession[],
  subAgents: [] as SubAgent[],
  subAgentsError: null as string | null,
  selectedSessionKey: null as string | null,
  loading: false,
  fetchError: null as string | null,
  selectSession: vi.fn(),
  fetchSessions: vi.fn().mockResolvedValue(undefined),
  killSession: vi.fn().mockResolvedValue(undefined),
  steerSubAgent: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../../stores/sessions', () => ({
  useSessionsStore: Object.assign(
    vi.fn((selector: (s: typeof mockStoreState) => unknown) => selector(mockStoreState)),
    { getState: () => mockStoreState }
  ),
}))

vi.mock('../../../stores/ui', () => ({
  useUIStore: vi.fn((selector: (s: { activeView: string }) => unknown) =>
    selector({ activeView: 'sessions' })
  ),
}))

vi.mock('../SpawnModal', () => ({
  SpawnModal: () => null,
}))

describe('SessionList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState = {
      sessions: [],
      subAgents: [],
      subAgentsError: null,
      selectedSessionKey: null,
      loading: false,
      fetchError: null,
      selectSession: vi.fn(),
      fetchSessions: vi.fn().mockResolvedValue(undefined),
      killSession: vi.fn().mockResolvedValue(undefined),
      steerSubAgent: vi.fn().mockResolvedValue(undefined),
    }
  })

  it('renders EmptyState when no sessions', () => {
    render(<SessionList />)
    expect(screen.getByText('No active sessions')).toBeInTheDocument()
  })

  it('renders Running group header when running sessions exist', () => {
    mockStoreState.sessions = [makeSession({ key: 'r1', updatedAt: Date.now() })]
    render(<SessionList />)
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('renders Recent group header when recent sessions exist', () => {
    const tenMinAgo = Date.now() - 10 * 60 * 1000
    mockStoreState.sessions = [makeSession({ key: 'r1', updatedAt: tenMinAgo })]
    render(<SessionList />)
    expect(screen.getByText('Recent')).toBeInTheDocument()
  })

  it('clicking a session row calls selectSession', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    mockStoreState.sessions = [makeSession({ key: 'sess-1', displayName: 'My Session' })]
    render(<SessionList />)

    await user.click(screen.getByText('My Session'))
    expect(mockStoreState.selectSession).toHaveBeenCalledWith('sess-1')
  })

  it('kill button visible only for running sessions', () => {
    const running = makeSession({ key: 'running', updatedAt: Date.now() })
    const stale = makeSession({ key: 'stale', updatedAt: Date.now() - FIVE_MINUTES - 1000 })
    mockStoreState.sessions = [running, stale]
    render(<SessionList />)

    const killButtons = screen.getAllByTitle('Stop session')
    expect(killButtons).toHaveLength(1)
  })

  it('renders Sub-agents group when subAgents is non-empty', () => {
    mockStoreState.subAgents = [makeSubAgent()]
    render(<SessionList />)
    expect(screen.getByText(/Sub-agents/)).toBeInTheDocument()
  })

  it('shows Spawn button', () => {
    render(<SessionList />)
    expect(screen.getByTitle('Spawn new agent')).toBeInTheDocument()
  })

  it('shows error message when fetchError is set', () => {
    mockStoreState.fetchError = 'Could not reach gateway'
    render(<SessionList />)
    expect(screen.getByText('Could not reach gateway')).toBeInTheDocument()
  })
})
