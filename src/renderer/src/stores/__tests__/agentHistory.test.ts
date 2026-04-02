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
      loading: false
    })
    vi.clearAllMocks()
    // Reset queued mockResolvedValueOnce from previous tests
    vi.mocked(window.api.agents.readLog).mockReset()
    vi.mocked(window.api.agents.readLog).mockResolvedValue({ content: '', nextByte: 0 })
  })

  afterEach(() => {
    // Stop any active polling before restoring timers
    useAgentHistoryStore.getState().stopLogPolling()
    vi.useRealTimers()
  })

  it('fetchAgents calls window.api.agents.list and sets state', async () => {
    const mockAgents = [
      {
        id: 'a1',
        pid: null,
        bin: 'claude',
        model: 'sonnet',
        repo: 'BDE',
        repoPath: '/tmp',
        task: 'fix bug',
        startedAt: '2026-01-01',
        finishedAt: null,
        exitCode: null,
        status: 'running' as const,
        logPath: '/tmp/log',
        source: 'bde' as const,
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: null
      },
      {
        id: 'a2',
        pid: null,
        bin: 'claude',
        model: 'opus',
        repo: 'BDE',
        repoPath: '/tmp',
        task: 'write tests',
        startedAt: '2026-01-02',
        finishedAt: '2026-01-02',
        exitCode: 0,
        status: 'done' as const,
        logPath: '/tmp/log2',
        source: 'bde' as const,
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        sprintTaskId: null
      }
    ]
    vi.mocked(window.api.agents.list).mockResolvedValue(mockAgents)

    await useAgentHistoryStore.getState().fetchAgents()

    const state = useAgentHistoryStore.getState()
    expect(state.agents).toHaveLength(2)
    expect(state.agents[0].id).toBe('a1')
    expect(state.agents[1].id).toBe('a2')
    expect(window.api.agents.list).toHaveBeenCalledWith({ limit: 100 })
  })

  it('selectAgent sets selectedId, clears log state, and starts polling', async () => {
    vi.mocked(window.api.agents.readLog).mockResolvedValue({ content: 'test output', nextByte: 11 })

    useAgentHistoryStore.setState({
      logContent: 'old content',
      logNextByte: 42
    })

    useAgentHistoryStore.getState().selectAgent('agent-x')

    const state = useAgentHistoryStore.getState()
    expect(state.selectedId).toBe('agent-x')
    expect(state.logContent).toBe('')
    expect(state.logNextByte).toBe(0)

    // Verify polling started by checking log content appears
    await vi.advanceTimersByTimeAsync(0)
    expect(useAgentHistoryStore.getState().logContent).toBe('test output')
    expect(window.api.agents.readLog).toHaveBeenCalledWith({ id: 'agent-x', fromByte: 0 })
  })

  it('stopLogPolling prevents further log accumulation', async () => {
    vi.mocked(window.api.agents.readLog)
      .mockResolvedValueOnce({ content: 'first ', nextByte: 6 })
      .mockResolvedValueOnce({ content: 'second', nextByte: 12 })

    useAgentHistoryStore.getState().startLogPolling('agent-x')

    // First poll fires
    await vi.advanceTimersByTimeAsync(0)
    expect(useAgentHistoryStore.getState().logContent).toBe('first ')

    useAgentHistoryStore.getState().stopLogPolling()

    // Advance past the next polling interval — content should not change
    await vi.advanceTimersByTimeAsync(2000)
    expect(useAgentHistoryStore.getState().logContent).toBe('first ')
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

  it('startLogPolling resets when called twice', async () => {
    vi.mocked(window.api.agents.readLog)
      .mockResolvedValueOnce({ content: 'from-agent-1', nextByte: 12 })
      .mockResolvedValueOnce({ content: 'from-agent-2', nextByte: 12 })

    useAgentHistoryStore.getState().startLogPolling('agent-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(useAgentHistoryStore.getState().logContent).toBe('from-agent-1')

    // Starting a new poll should work independently
    useAgentHistoryStore.setState({ logContent: '', logNextByte: 0 })
    useAgentHistoryStore.getState().startLogPolling('agent-2')
    await vi.advanceTimersByTimeAsync(0)
    expect(useAgentHistoryStore.getState().logContent).toBe('from-agent-2')
  })

  it('fetchAgents silently handles errors', async () => {
    vi.mocked(window.api.agents.list).mockRejectedValue(new Error('network'))

    await useAgentHistoryStore.getState().fetchAgents()

    expect(useAgentHistoryStore.getState().agents).toEqual([])
  })

  it('importExternal calls api and refetches agents', async () => {
    const imported = {
      id: 'ext-1',
      pid: null,
      bin: 'ext',
      model: 'sonnet',
      repo: '',
      repoPath: '',
      task: '',
      startedAt: '',
      finishedAt: null,
      exitCode: null,
      status: 'done' as const,
      logPath: '',
      source: 'external' as const,
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    }
    vi.mocked(window.api.agents.import).mockResolvedValue(imported)
    vi.mocked(window.api.agents.list).mockResolvedValue([imported])

    await useAgentHistoryStore.getState().importExternal({ bin: 'ext' }, 'log content')

    expect(window.api.agents.import).toHaveBeenCalledWith({
      meta: { bin: 'ext' },
      content: 'log content'
    })
    expect(window.api.agents.list).toHaveBeenCalled()
  })
})
