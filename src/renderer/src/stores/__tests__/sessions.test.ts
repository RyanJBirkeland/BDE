import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSessionsStore, type AgentSession } from '../sessions'

vi.mock('../../lib/rpc', () => ({
  invokeTool: vi.fn(),
}))

vi.mock('../toasts', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import { invokeTool } from '../../lib/rpc'

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
    contextWindowSize: 500,
    inputTokens: 400,
    outputTokens: 600,
    abortedLastRun: false,
    ...overrides,
  }
}

describe('fetchSessions', () => {
  beforeEach(() => {
    // Reset the store to initial state
    useSessionsStore.setState({
      sessions: [],
      selectedSessionKey: null,
      runningCount: 0,
      loading: true,
      fetchError: null,
    })
    vi.clearAllMocks()
  })

  it('parses sessions from invokeTool correctly', async () => {
    const sessions = [makeSession({ key: 'a' }), makeSession({ key: 'b' })]
    vi.mocked(invokeTool).mockResolvedValue({ sessions, count: 2 })

    await useSessionsStore.getState().fetchSessions()

    const state = useSessionsStore.getState()
    expect(state.sessions).toHaveLength(2)
    expect(state.sessions[0].key).toBe('a')
    expect(state.sessions[1].key).toBe('b')
  })

  it('sets runningCount correctly based on updatedAt', async () => {
    const recent = makeSession({ key: 'recent', updatedAt: Date.now() })
    const stale = makeSession({ key: 'stale', updatedAt: Date.now() - 10 * 60 * 1000 })
    vi.mocked(invokeTool).mockResolvedValue({ sessions: [recent, stale], count: 2 })

    await useSessionsStore.getState().fetchSessions()

    expect(useSessionsStore.getState().runningCount).toBe(1)
  })

  it('sets loading: false after fetch', async () => {
    vi.mocked(invokeTool).mockResolvedValue({ sessions: [], count: 0 })

    await useSessionsStore.getState().fetchSessions()

    expect(useSessionsStore.getState().loading).toBe(false)
  })

  it('sets fetchError on failure', async () => {
    vi.mocked(invokeTool).mockRejectedValue(new Error('Network error'))

    await useSessionsStore.getState().fetchSessions()

    const state = useSessionsStore.getState()
    expect(state.fetchError).toBe('Could not reach gateway')
    expect(state.loading).toBe(false)
  })
})
