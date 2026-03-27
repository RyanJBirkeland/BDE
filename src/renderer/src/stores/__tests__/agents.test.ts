/**
 * Tests for the unified useAgentsStore — covers all 4 merged sections:
 * local processes, history, unified view, events.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAgentsStore } from '../agents'
import type { AgentEvent } from '../../../../shared/types'

function makeEvent(text = 'hello'): AgentEvent {
  return { type: 'agent:text', text, timestamp: Date.now() }
}

beforeEach(() => {
  useAgentsStore.setState({
    // Local
    processes: [],
    spawnedAgents: [],
    collapsed: false,
    isSpawning: false,
    selectedLocalAgentPid: null,
    localLog: { logContent: '', logNextByte: 0, logTrimmedLines: 0 },
    // History
    historyAgents: [],
    historySelectedId: null,
    historyLoading: false,
    historyLog: { logContent: '', logNextByte: 0, logTrimmedLines: 0 },
    // Unified
    agents: [],
    selectedId: null,
    loading: false,
    // Events
    events: {}
  })
  vi.clearAllMocks()
})

// ── Local Processes ───────────────────────────────────────────

describe('local processes', () => {
  it('fetchProcesses sets processes from getAgentProcesses', async () => {
    const mockProcs = [
      { pid: 100, bin: 'claude', args: '--task fix', cwd: '/tmp/repo', startedAt: Date.now(), cpuPct: 5, memMb: 120 },
      { pid: 200, bin: 'claude', args: '--task test', cwd: '/tmp/repo2', startedAt: Date.now(), cpuPct: 3, memMb: 80 }
    ]
    vi.mocked(window.api.getAgentProcesses).mockResolvedValue(mockProcs)

    await useAgentsStore.getState().fetchProcesses()

    const state = useAgentsStore.getState()
    expect(state.processes).toHaveLength(2)
    expect(state.processes[0].pid).toBe(100)
  })

  it('fetchProcesses silently handles errors', async () => {
    vi.mocked(window.api.getAgentProcesses).mockRejectedValue(new Error('fail'))
    await useAgentsStore.getState().fetchProcesses()
    expect(useAgentsStore.getState().processes).toEqual([])
  })

  it('spawnAgent calls spawnLocalAgent, adds to spawnedAgents', async () => {
    vi.mocked(window.api.spawnLocalAgent).mockResolvedValue({
      pid: 999, logPath: '/tmp/agent.log', id: 'spawn-1', interactive: true
    })

    const result = await useAgentsStore.getState().spawnAgent({
      task: 'write tests', repoPath: '/tmp/repo', model: 'opus'
    })

    expect(result.pid).toBe(999)
    expect(result.id).toBe('spawn-1')
    const state = useAgentsStore.getState()
    expect(state.spawnedAgents).toHaveLength(1)
    expect(state.spawnedAgents[0].task).toBe('write tests')
    expect(state.spawnedAgents[0].model).toBe('opus')
    expect(state.spawnedAgents[0].interactive).toBe(true)
  })

  it('spawnAgent defaults model to sonnet when not provided', async () => {
    vi.mocked(window.api.spawnLocalAgent).mockResolvedValue({
      pid: 888, logPath: '/tmp/log', id: 'spawn-2', interactive: false
    })
    await useAgentsStore.getState().spawnAgent({ task: 'fix bug', repoPath: '/tmp/repo' })
    expect(useAgentsStore.getState().spawnedAgents[0].model).toBe('sonnet')
  })

  it('sendToAgent throws on { ok: false }', async () => {
    vi.mocked(window.api.sendToAgent).mockResolvedValue({ ok: false, error: 'agent busy' })
    await expect(useAgentsStore.getState().sendToAgent(123, 'hello')).rejects.toThrow('agent busy')
  })

  it('sendToAgent resolves on { ok: true }', async () => {
    vi.mocked(window.api.sendToAgent).mockResolvedValue({ ok: true })
    await expect(useAgentsStore.getState().sendToAgent(123, 'hello')).resolves.toBeUndefined()
  })

  it('killLocalAgent calls IPC and does NOT remove process', async () => {
    useAgentsStore.setState({
      processes: [{ pid: 100, bin: 'claude', args: '', cwd: null, startedAt: Date.now(), cpuPct: 0, memMb: 0 }]
    })
    await useAgentsStore.getState().killLocalAgent(100)
    expect(window.api.killLocalAgent).toHaveBeenCalledWith(100)
    expect(useAgentsStore.getState().processes).toHaveLength(1)
  })

  it('selectLocalAgent resets log state', () => {
    useAgentsStore.setState({
      localLog: { logContent: 'existing', logNextByte: 8, logTrimmedLines: 0 }
    })
    useAgentsStore.getState().selectLocalAgent(555)
    const state = useAgentsStore.getState()
    expect(state.selectedLocalAgentPid).toBe(555)
    expect(state.localLog.logContent).toBe('')
    expect(state.localLog.logNextByte).toBe(0)
  })
})

// ── Local Log Polling ────────────────────────────────────────

describe('local log polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(window.api.tailAgentLog).mockReset()
    vi.mocked(window.api.tailAgentLog).mockResolvedValue({ content: '', nextByte: 0 })
  })
  afterEach(() => {
    useAgentsStore.getState().stopLocalLogPolling()
    vi.useRealTimers()
  })

  it('accumulates content and advances logNextByte', async () => {
    vi.mocked(window.api.tailAgentLog)
      .mockResolvedValueOnce({ content: 'chunk1 ', nextByte: 7 })
      .mockResolvedValueOnce({ content: 'chunk2', nextByte: 13 })

    useAgentsStore.getState().startLocalLogPolling('/tmp/agent.log')

    await vi.advanceTimersByTimeAsync(0)
    expect(useAgentsStore.getState().localLog.logContent).toBe('chunk1 ')
    expect(useAgentsStore.getState().localLog.logNextByte).toBe(7)

    await vi.advanceTimersByTimeAsync(1000)
    expect(useAgentsStore.getState().localLog.logContent).toBe('chunk1 chunk2')
    expect(useAgentsStore.getState().localLog.logNextByte).toBe(13)
  })

  it('stopLocalLogPolling prevents further log accumulation', async () => {
    vi.mocked(window.api.tailAgentLog)
      .mockResolvedValueOnce({ content: 'first ', nextByte: 6 })
      .mockResolvedValueOnce({ content: 'second', nextByte: 12 })

    useAgentsStore.getState().startLocalLogPolling('/tmp/log')
    await vi.advanceTimersByTimeAsync(0)
    expect(useAgentsStore.getState().localLog.logContent).toBe('first ')

    useAgentsStore.getState().stopLocalLogPolling()
    await vi.advanceTimersByTimeAsync(2000)
    expect(useAgentsStore.getState().localLog.logContent).toBe('first ')
  })
})

// ── Agent History ────────────────────────────────────────────

describe('agent history', () => {
  it('fetchAgents calls window.api.agents.list and sets state', async () => {
    const mockAgents = [
      {
        id: 'a1', pid: null, bin: 'claude', model: 'sonnet', repo: 'BDE',
        repoPath: '/tmp', task: 'fix bug', startedAt: '2026-01-01',
        finishedAt: null, exitCode: null, status: 'running' as const,
        logPath: '/tmp/log', source: 'bde' as const,
        costUsd: null, tokensIn: null, tokensOut: null, sprintTaskId: null
      },
      {
        id: 'a2', pid: null, bin: 'claude', model: 'opus', repo: 'BDE',
        repoPath: '/tmp', task: 'write tests', startedAt: '2026-01-02',
        finishedAt: '2026-01-02', exitCode: 0, status: 'done' as const,
        logPath: '/tmp/log2', source: 'bde' as const,
        costUsd: null, tokensIn: null, tokensOut: null, sprintTaskId: null
      }
    ]
    vi.mocked(window.api.agents.list).mockResolvedValue(mockAgents)

    await useAgentsStore.getState().fetchAgents()

    const state = useAgentsStore.getState()
    expect(state.historyAgents).toHaveLength(2)
    expect(state.historyAgents[0].id).toBe('a1')
    expect(state.historyAgents[1].id).toBe('a2')
    expect(window.api.agents.list).toHaveBeenCalledWith({ limit: 100 })
  })

  it('fetchAgents silently handles errors', async () => {
    vi.mocked(window.api.agents.list).mockRejectedValue(new Error('network'))
    await useAgentsStore.getState().fetchAgents()
    expect(useAgentsStore.getState().historyAgents).toEqual([])
  })

  it('selectAgent sets historySelectedId and clears log state', () => {
    useAgentsStore.setState({
      historyLog: { logContent: 'old content', logNextByte: 42, logTrimmedLines: 0 }
    })
    useAgentsStore.getState().selectAgent('agent-x')
    const state = useAgentsStore.getState()
    expect(state.historySelectedId).toBe('agent-x')
    expect(state.historyLog.logContent).toBe('')
    expect(state.historyLog.logNextByte).toBe(0)
  })

  it('importExternal calls api and refetches agents', async () => {
    const imported = {
      id: 'ext-1', pid: null, bin: 'ext', model: 'sonnet', repo: '', repoPath: '',
      task: '', startedAt: '', finishedAt: null, exitCode: null, status: 'done' as const,
      logPath: '', source: 'external' as const,
      costUsd: null, tokensIn: null, tokensOut: null, sprintTaskId: null
    }
    vi.mocked(window.api.agents.import).mockResolvedValue(imported)
    vi.mocked(window.api.agents.list).mockResolvedValue([imported])

    await useAgentsStore.getState().importExternal({ bin: 'ext' }, 'log content')

    expect(window.api.agents.import).toHaveBeenCalledWith({ meta: { bin: 'ext' }, content: 'log content' })
    expect(window.api.agents.list).toHaveBeenCalled()
  })
})

// ── History Log Polling ──────────────────────────────────────

describe('history log polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(window.api.agents.readLog).mockReset()
    vi.mocked(window.api.agents.readLog).mockResolvedValue({ content: '', nextByte: 0 })
  })
  afterEach(() => {
    useAgentsStore.getState().stopHistoryLogPolling()
    vi.useRealTimers()
  })

  it('selectAgent starts polling and content appears', async () => {
    vi.mocked(window.api.agents.readLog).mockResolvedValue({ content: 'test output', nextByte: 11 })
    useAgentsStore.getState().selectAgent('agent-x')
    await vi.advanceTimersByTimeAsync(0)
    expect(useAgentsStore.getState().historyLog.logContent).toBe('test output')
    expect(window.api.agents.readLog).toHaveBeenCalledWith({ id: 'agent-x', fromByte: 0 })
  })

  it('stopHistoryLogPolling prevents further log accumulation', async () => {
    vi.mocked(window.api.agents.readLog)
      .mockResolvedValueOnce({ content: 'first ', nextByte: 6 })
      .mockResolvedValueOnce({ content: 'second', nextByte: 12 })

    useAgentsStore.getState().startHistoryLogPolling('agent-x')
    await vi.advanceTimersByTimeAsync(0)
    expect(useAgentsStore.getState().historyLog.logContent).toBe('first ')

    useAgentsStore.getState().stopHistoryLogPolling()
    await vi.advanceTimersByTimeAsync(2000)
    expect(useAgentsStore.getState().historyLog.logContent).toBe('first ')
  })

  it('log polling accumulates content and advances logNextByte', async () => {
    vi.mocked(window.api.agents.readLog)
      .mockResolvedValueOnce({ content: 'hello ', nextByte: 6 })
      .mockResolvedValueOnce({ content: 'world', nextByte: 11 })

    useAgentsStore.getState().startHistoryLogPolling('agent-y')
    await vi.advanceTimersByTimeAsync(0)
    expect(useAgentsStore.getState().historyLog.logContent).toBe('hello ')
    expect(useAgentsStore.getState().historyLog.logNextByte).toBe(6)

    await vi.advanceTimersByTimeAsync(1000)
    expect(useAgentsStore.getState().historyLog.logContent).toBe('hello world')
    expect(useAgentsStore.getState().historyLog.logNextByte).toBe(11)
  })

  it('startHistoryLogPolling resets when called twice', async () => {
    vi.mocked(window.api.agents.readLog)
      .mockResolvedValueOnce({ content: 'from-agent-1', nextByte: 12 })
      .mockResolvedValueOnce({ content: 'from-agent-2', nextByte: 12 })

    useAgentsStore.getState().startHistoryLogPolling('agent-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(useAgentsStore.getState().historyLog.logContent).toBe('from-agent-1')

    useAgentsStore.setState({ historyLog: { logContent: '', logNextByte: 0, logTrimmedLines: 0 } })
    useAgentsStore.getState().startHistoryLogPolling('agent-2')
    await vi.advanceTimersByTimeAsync(0)
    expect(useAgentsStore.getState().historyLog.logContent).toBe('from-agent-2')
  })
})

// ── Unified View ─────────────────────────────────────────────

describe('unified view: fetchAll', () => {
  it('sets loading true then false around fetching', async () => {
    let loadingDuringFetch = false
    vi.mocked(window.api.getAgentProcesses).mockImplementation(async () => {
      loadingDuringFetch = useAgentsStore.getState().loading
      return []
    })
    vi.mocked(window.api.agents.list).mockResolvedValue([])

    await useAgentsStore.getState().fetchAll()

    expect(loadingDuringFetch).toBe(true)
    expect(useAgentsStore.getState().loading).toBe(false)
  })

  it('populates agents from local processes', async () => {
    vi.mocked(window.api.getAgentProcesses).mockResolvedValue([
      { pid: 100, bin: 'claude', args: '', cwd: '/repo/bde', startedAt: Date.now(), cpuPct: 0, memMb: 0 }
    ])
    vi.mocked(window.api.agents.list).mockResolvedValue([])

    await useAgentsStore.getState().fetchAll()

    const { agents } = useAgentsStore.getState()
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toBe('local:100')
    expect(agents[0].source).toBe('local')
    expect(agents[0].status).toBe('running')
  })

  it('populates agents from history', async () => {
    vi.mocked(window.api.getAgentProcesses).mockResolvedValue([])
    vi.mocked(window.api.agents.list).mockResolvedValue([
      {
        id: 'hist-1', bin: 'claude', source: 'external', status: 'done',
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString()
      } as Parameters<typeof window.api.agents.list>[0] extends { limit: number }
        ? Awaited<ReturnType<typeof window.api.agents.list>>[number]
        : never
    ])

    await useAgentsStore.getState().fetchAll()

    const { agents } = useAgentsStore.getState()
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toBe('history:hist-1')
    expect(agents[0].source).toBe('history')
  })

  it('handles errors gracefully and still clears loading', async () => {
    vi.mocked(window.api.getAgentProcesses).mockRejectedValue(new Error('IPC error'))
    vi.mocked(window.api.agents.list).mockRejectedValue(new Error('IPC error'))

    await useAgentsStore.getState().fetchAll()

    expect(useAgentsStore.getState().loading).toBe(false)
  })
})

describe('unified view: select', () => {
  it('sets selectedId', () => {
    useAgentsStore.getState().select('history:abc')
    expect(useAgentsStore.getState().selectedId).toBe('history:abc')
  })

  it('accepts null to deselect', () => {
    useAgentsStore.setState({ selectedId: 'history:abc' })
    useAgentsStore.getState().select(null)
    expect(useAgentsStore.getState().selectedId).toBeNull()
  })

  it('routes local: prefix to selectLocalAgent', () => {
    useAgentsStore.getState().select('local:42')
    expect(useAgentsStore.getState().selectedLocalAgentPid).toBe(42)
  })

  it('routes history: prefix to selectAgent', () => {
    useAgentsStore.getState().select('history:xyz')
    expect(useAgentsStore.getState().historySelectedId).toBe('xyz')
  })
})

describe('unified view: spawn', () => {
  it('calls spawnAgent with the task', async () => {
    vi.mocked(window.api.spawnLocalAgent).mockResolvedValue({
      pid: 999, logPath: '/tmp/log', id: 'agent-x', interactive: false
    })
    vi.mocked(window.api.getAgentProcesses).mockResolvedValue([])
    vi.mocked(window.api.agents.list).mockResolvedValue([])

    await useAgentsStore.getState().spawn({ task: 'write tests', repoPath: '/repo' })

    expect(window.api.spawnLocalAgent).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'write tests', repoPath: '/repo' })
    )
  })

  it('prepends planning prompt when planning=true', async () => {
    vi.mocked(window.api.spawnLocalAgent).mockResolvedValue({
      pid: 111, logPath: '/tmp/log', id: 'plan-1', interactive: false
    })
    vi.mocked(window.api.getAgentProcesses).mockResolvedValue([])
    vi.mocked(window.api.agents.list).mockResolvedValue([])

    await useAgentsStore.getState().spawn({ task: 'plan new feature', repoPath: '/repo', planning: true })

    const call = vi.mocked(window.api.spawnLocalAgent).mock.calls[0][0]
    expect(call.task).toContain('You are a coding partner')
    expect(call.task).toContain('plan new feature')
  })

  it('shows toast on success and refreshes agents', async () => {
    vi.mocked(window.api.spawnLocalAgent).mockResolvedValue({
      pid: 222, logPath: '/tmp/log', id: 'ok-1', interactive: false
    })
    vi.mocked(window.api.getAgentProcesses).mockResolvedValue([
      { pid: 222, bin: 'claude', args: '', cwd: null, startedAt: Date.now(), cpuPct: 0, memMb: 0 }
    ])
    vi.mocked(window.api.agents.list).mockResolvedValue([])

    await useAgentsStore.getState().spawn({ task: 'do work', repoPath: '/repo' })

    expect(useAgentsStore.getState().agents).toHaveLength(1)
  })
})

describe('unified view: steer', () => {
  it('delegates to sendToAgent for local source agents', async () => {
    useAgentsStore.setState({
      agents: [{
        id: 'local:50', source: 'local', status: 'running', pid: 50,
        label: 'agent', model: '', updatedAt: 0, startedAt: 0,
        canSteer: true, canKill: true, isBlocked: false
      }]
    })
    vi.mocked(window.api.sendToAgent).mockResolvedValue({ ok: true })

    await useAgentsStore.getState().steer('local:50', 'stop now')
    expect(window.api.sendToAgent).toHaveBeenCalledWith(50, 'stop now')
  })

  it('does nothing for unknown agent id', async () => {
    await useAgentsStore.getState().steer('local:999', 'msg')
    expect(window.api.sendToAgent).not.toHaveBeenCalled()
  })

  it('does nothing for history source agents', async () => {
    useAgentsStore.setState({
      agents: [{
        id: 'history:abc', source: 'history', status: 'done',
        label: 'old agent', model: '', updatedAt: 0, startedAt: 0, historyId: 'abc'
      }]
    })
    await useAgentsStore.getState().steer('history:abc', 'msg')
    expect(window.api.sendToAgent).not.toHaveBeenCalled()
  })
})

describe('unified view: kill', () => {
  it('delegates to killLocalAgent for local agents', async () => {
    vi.mocked(window.api.killLocalAgent).mockResolvedValue({ ok: true })
    const agent = {
      id: 'local:75', source: 'local' as const, status: 'running' as const,
      pid: 75, label: 'agent', model: '', updatedAt: 0, startedAt: 0,
      canSteer: false, canKill: true, isBlocked: false
    }
    await useAgentsStore.getState().kill(agent)
    expect(window.api.killLocalAgent).toHaveBeenCalledWith(75)
  })

  it('does not call kill IPC for history agents', async () => {
    const agent = {
      id: 'history:abc', source: 'history' as const, status: 'done' as const,
      label: 'old', model: '', updatedAt: 0, startedAt: 0, historyId: 'abc'
    }
    await useAgentsStore.getState().kill(agent)
    expect(window.api.killLocalAgent).not.toHaveBeenCalled()
  })
})

// ── Events ───────────────────────────────────────────────────

describe('events: initEvents', () => {
  it('subscribes to agentEvents.onEvent and returns unsubscribe function', () => {
    const unsubscribe = vi.fn()
    vi.mocked(window.api.agentEvents.onEvent).mockReturnValue(unsubscribe)

    const cleanup = useAgentsStore.getState().initEvents()

    expect(window.api.agentEvents.onEvent).toHaveBeenCalledOnce()
    expect(cleanup).toBe(unsubscribe)
  })

  it('appends events to the correct agent bucket', () => {
    let capturedCallback: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      capturedCallback = cb
      return () => {}
    })

    useAgentsStore.getState().initEvents()
    capturedCallback!({ agentId: 'agent-a', event: makeEvent('first') })

    const { events } = useAgentsStore.getState()
    expect(events['agent-a']).toHaveLength(1)
    expect((events['agent-a'][0] as { type: string; text: string }).text).toBe('first')
  })

  it('accumulates multiple events for the same agent', () => {
    let capturedCallback: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      capturedCallback = cb
      return () => {}
    })

    useAgentsStore.getState().initEvents()
    capturedCallback!({ agentId: 'agent-b', event: makeEvent('e1') })
    capturedCallback!({ agentId: 'agent-b', event: makeEvent('e2') })

    expect(useAgentsStore.getState().events['agent-b']).toHaveLength(2)
  })

  it('keeps events for different agents isolated', () => {
    let capturedCallback: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      capturedCallback = cb
      return () => {}
    })

    useAgentsStore.getState().initEvents()
    capturedCallback!({ agentId: 'agent-x', event: makeEvent('ex') })
    capturedCallback!({ agentId: 'agent-y', event: makeEvent('ey') })

    expect(useAgentsStore.getState().events['agent-x']).toHaveLength(1)
    expect(useAgentsStore.getState().events['agent-y']).toHaveLength(1)
  })
})

describe('events: loadEventHistory', () => {
  it('fetches history from IPC and stores it', async () => {
    const history = [makeEvent('h1'), makeEvent('h2')]
    vi.mocked(window.api.agentEvents.getHistory).mockResolvedValue(history)

    await useAgentsStore.getState().loadEventHistory('agent-z')

    expect(window.api.agentEvents.getHistory).toHaveBeenCalledWith('agent-z')
    expect(useAgentsStore.getState().events['agent-z']).toHaveLength(2)
  })

  it('overwrites previously cached events for that agent', async () => {
    useAgentsStore.setState({ events: { 'agent-z': [makeEvent('old-1'), makeEvent('old-2')] } })
    vi.mocked(window.api.agentEvents.getHistory).mockResolvedValue([makeEvent('new-1')])

    await useAgentsStore.getState().loadEventHistory('agent-z')

    const stored = useAgentsStore.getState().events['agent-z']
    expect(stored).toHaveLength(1)
    expect((stored[0] as { type: string; text: string }).text).toBe('new-1')
  })

  it('does not affect events for other agents', async () => {
    useAgentsStore.setState({ events: { other: [makeEvent('o1')] } })
    vi.mocked(window.api.agentEvents.getHistory).mockResolvedValue([makeEvent('n1')])

    await useAgentsStore.getState().loadEventHistory('target')

    expect(useAgentsStore.getState().events['other']).toHaveLength(1)
  })
})

describe('events: clearEvents', () => {
  it('removes the event bucket for the given agent', () => {
    useAgentsStore.setState({
      events: { 'agent-a': [makeEvent('a1')], 'agent-b': [makeEvent('b1')] }
    })
    useAgentsStore.getState().clearEvents('agent-a')

    const { events } = useAgentsStore.getState()
    expect(events['agent-a']).toBeUndefined()
  })

  it('leaves other agent events untouched', () => {
    useAgentsStore.setState({
      events: { 'agent-a': [makeEvent('a1')], 'agent-b': [makeEvent('b1')] }
    })
    useAgentsStore.getState().clearEvents('agent-a')
    expect(useAgentsStore.getState().events['agent-b']).toHaveLength(1)
  })

  it('is a no-op for an agent id that has no events', () => {
    useAgentsStore.setState({ events: {} })
    useAgentsStore.getState().clearEvents('nonexistent')
    expect(useAgentsStore.getState().events).toEqual({})
  })
})

describe('event cap (MAX_EVENTS_PER_AGENT = 2000)', () => {
  it('allows up to 2000 events without eviction', () => {
    let capturedCallback: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      capturedCallback = cb
      return () => {}
    })

    useAgentsStore.getState().initEvents()
    for (let i = 0; i < 2000; i++) {
      capturedCallback!({ agentId: 'agent-cap', event: makeEvent(`e${i}`) })
    }
    expect(useAgentsStore.getState().events['agent-cap']).toHaveLength(2000)
  })

  it('evicts oldest events once cap is exceeded', () => {
    let capturedCallback: ((payload: { agentId: string; event: AgentEvent }) => void) | null = null
    vi.mocked(window.api.agentEvents.onEvent).mockImplementation((cb) => {
      capturedCallback = cb
      return () => {}
    })

    useAgentsStore.getState().initEvents()
    for (let i = 0; i < 2001; i++) {
      capturedCallback!({ agentId: 'agent-cap', event: makeEvent(`e${i}`) })
    }

    const events = useAgentsStore.getState().events['agent-cap']
    expect(events).toHaveLength(2000)
    expect((events[0] as { text: string }).text).toBe('e1')
    expect((events[events.length - 1] as { text: string }).text).toBe('e2000')
  })

  it('caps loadEventHistory at 2000 events, keeping the most recent', async () => {
    const bigHistory = Array.from({ length: 2500 }, (_, i) => makeEvent(`h${i}`))
    vi.mocked(window.api.agentEvents.getHistory).mockResolvedValue(bigHistory)

    await useAgentsStore.getState().loadEventHistory('agent-hist')

    const events = useAgentsStore.getState().events['agent-hist']
    expect(events).toHaveLength(2000)
    expect((events[0] as { text: string }).text).toBe('h500')
    expect((events[events.length - 1] as { text: string }).text).toBe('h2499')
  })
})
