import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAgentHistoryStore } from '../agentHistory'

describe('agentHistory store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useAgentHistoryStore.setState({
      agents: [],
      selectedId: null,
      logContent: '',
      logNextByte: 0,
      loading: false,
      _logInterval: null,
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up any intervals
    const { _logInterval } = useAgentHistoryStore.getState()
    if (_logInterval) clearInterval(_logInterval)
    vi.useRealTimers()
  })

  it('fetchAgents calls window.api.agents.list and sets state', async () => {
    const mockAgents = [
      { id: 'a1', pid: null, bin: 'claude', model: 'sonnet', repo: 'BDE', repoPath: '/tmp', task: 'fix bug', startedAt: '2026-01-01', finishedAt: null, exitCode: null, status: 'running' as const, logPath: '/tmp/log', source: 'bde' as const },
      { id: 'a2', pid: null, bin: 'claude', model: 'opus', repo: 'BDE', repoPath: '/tmp', task: 'write tests', startedAt: '2026-01-02', finishedAt: '2026-01-02', exitCode: 0, status: 'done' as const, logPath: '/tmp/log2', source: 'bde' as const },
    ]
    vi.mocked(window.api.agents.list).mockResolvedValue(mockAgents)

    await useAgentHistoryStore.getState().fetchAgents()

    const state = useAgentHistoryStore.getState()
    expect(state.agents).toHaveLength(2)
    expect(state.agents[0].id).toBe('a1')
    expect(state.agents[1].id).toBe('a2')
    expect(window.api.agents.list).toHaveBeenCalledWith({ limit: 100 })
  })

  it('selectAgent sets selectedId, clears log state, and calls startLogPolling', () => {
    vi.mocked(window.api.agents.readLog).mockResolvedValue({ content: '', nextByte: 0 })

    useAgentHistoryStore.setState({
      logContent: 'old content',
      logNextByte: 42,
    })

    useAgentHistoryStore.getState().selectAgent('agent-x')

    const state = useAgentHistoryStore.getState()
    expect(state.selectedId).toBe('agent-x')
    expect(state.logContent).toBe('')
    expect(state.logNextByte).toBe(0)
    expect(state._logInterval).not.toBeNull()
    expect(window.api.agents.readLog).toHaveBeenCalledWith({ id: 'agent-x', fromByte: 0 })
  })

  it('stopLogPolling clears _logInterval', () => {
    vi.mocked(window.api.agents.readLog).mockResolvedValue({ content: '', nextByte: 0 })
    useAgentHistoryStore.getState().selectAgent('agent-x')

    expect(useAgentHistoryStore.getState()._logInterval).not.toBeNull()

    useAgentHistoryStore.getState().stopLogPolling()

    expect(useAgentHistoryStore.getState()._logInterval).toBeNull()
  })

  it('log polling accumulates content and advances logNextByte', async () => {
    vi.mocked(window.api.agents.readLog)
      .mockResolvedValueOnce({ content: 'hello ', nextByte: 6 })
      .mockResolvedValueOnce({ content: 'world', nextByte: 11 })

    useAgentHistoryStore.getState().startLogPolling('agent-y')

    // First poll fires immediately
    await vi.advanceTimersByTimeAsync(0)

    expect(useAgentHistoryStore.getState().logContent).toBe('hello ')
    expect(useAgentHistoryStore.getState().logNextByte).toBe(6)

    // Second poll after interval
    await vi.advanceTimersByTimeAsync(1000)

    expect(useAgentHistoryStore.getState().logContent).toBe('hello world')
    expect(useAgentHistoryStore.getState().logNextByte).toBe(11)
  })

  it('startLogPolling clears existing interval before starting new one', () => {
    vi.mocked(window.api.agents.readLog).mockResolvedValue({ content: '', nextByte: 0 })

    useAgentHistoryStore.getState().startLogPolling('agent-1')
    const firstInterval = useAgentHistoryStore.getState()._logInterval

    useAgentHistoryStore.getState().startLogPolling('agent-2')
    const secondInterval = useAgentHistoryStore.getState()._logInterval

    expect(firstInterval).not.toBe(secondInterval)
    expect(secondInterval).not.toBeNull()
  })

  it('fetchAgents silently handles errors', async () => {
    vi.mocked(window.api.agents.list).mockRejectedValue(new Error('network'))

    await useAgentHistoryStore.getState().fetchAgents()

    expect(useAgentHistoryStore.getState().agents).toEqual([])
  })

  it('importExternal calls api and refetches agents', async () => {
    const imported = { id: 'ext-1', pid: null, bin: 'ext', model: 'sonnet', repo: '', repoPath: '', task: '', startedAt: '', finishedAt: null, exitCode: null, status: 'done' as const, logPath: '', source: 'external' as const }
    vi.mocked(window.api.agents.import).mockResolvedValue(imported)
    vi.mocked(window.api.agents.list).mockResolvedValue([imported])

    await useAgentHistoryStore.getState().importExternal({ bin: 'ext' }, 'log content')

    expect(window.api.agents.import).toHaveBeenCalledWith({ meta: { bin: 'ext' }, content: 'log content' })
    expect(window.api.agents.list).toHaveBeenCalled()
  })
})
