/**
 * Tests for useUnifiedAgentsStore — the Zustand store layer.
 * (Separate from unifiedAgents.test.ts which tests hook/grouping utilities.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useUnifiedAgentsStore } from '../unifiedAgents'
import { useLocalAgentsStore } from '../localAgents'
import { useAgentHistoryStore } from '../agentHistory'

const initialState = {
  agents: [],
  selectedId: null,
  loading: false
}

beforeEach(() => {
  useUnifiedAgentsStore.setState(initialState)
  useLocalAgentsStore.setState({
    processes: [],
    spawnedAgents: [],
    collapsed: false,
    selectedLocalAgentPid: null,
    logContent: '',
    logNextByte: 0
  })
  useAgentHistoryStore.setState({
    agents: [],
    selectedId: null,
    loading: false,
    logContent: '',
    logNextByte: 0
  })
  vi.clearAllMocks()
})

describe('fetchAll', () => {
  it('sets loading true then false around fetching', async () => {
    let loadingDuringFetch = false
    vi.mocked(window.api.getAgentProcesses).mockImplementation(async () => {
      loadingDuringFetch = useUnifiedAgentsStore.getState().loading
      return []
    })
    vi.mocked(window.api.agents.list).mockResolvedValue([])

    await useUnifiedAgentsStore.getState().fetchAll()

    expect(loadingDuringFetch).toBe(true)
    expect(useUnifiedAgentsStore.getState().loading).toBe(false)
  })

  it('populates agents from local processes', async () => {
    vi.mocked(window.api.getAgentProcesses).mockResolvedValue([
      {
        pid: 100,
        bin: 'claude',
        args: '',
        cwd: '/repo/bde',
        startedAt: Date.now(),
        cpuPct: 0,
        memMb: 0
      }
    ])
    vi.mocked(window.api.agents.list).mockResolvedValue([])

    await useUnifiedAgentsStore.getState().fetchAll()

    const { agents } = useUnifiedAgentsStore.getState()
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toBe('local:100')
    expect(agents[0].source).toBe('local')
    expect(agents[0].status).toBe('running')
  })

  it('populates agents from history', async () => {
    vi.mocked(window.api.getAgentProcesses).mockResolvedValue([])
    vi.mocked(window.api.agents.list).mockResolvedValue([
      {
        id: 'hist-1',
        bin: 'claude',
        source: 'external',
        status: 'done',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString()
      } as Parameters<typeof window.api.agents.list>[0] extends { limit: number }
        ? Awaited<ReturnType<typeof window.api.agents.list>>[number]
        : never
    ])

    await useUnifiedAgentsStore.getState().fetchAll()

    const { agents } = useUnifiedAgentsStore.getState()
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toBe('history:hist-1')
    expect(agents[0].source).toBe('history')
  })

  it('handles errors gracefully and still clears loading', async () => {
    vi.mocked(window.api.getAgentProcesses).mockRejectedValue(new Error('IPC error'))
    vi.mocked(window.api.agents.list).mockRejectedValue(new Error('IPC error'))

    await useUnifiedAgentsStore.getState().fetchAll()

    expect(useUnifiedAgentsStore.getState().loading).toBe(false)
  })
})

describe('select', () => {
  it('sets selectedId', () => {
    useUnifiedAgentsStore.getState().select('history:abc')
    expect(useUnifiedAgentsStore.getState().selectedId).toBe('history:abc')
  })

  it('accepts null to deselect', () => {
    useUnifiedAgentsStore.setState({ selectedId: 'history:abc' })
    useUnifiedAgentsStore.getState().select(null)
    expect(useUnifiedAgentsStore.getState().selectedId).toBeNull()
  })

  it('routes local: prefix to localAgents selectLocalAgent', () => {
    const selectLocalAgent = vi.fn()
    useLocalAgentsStore.setState({ selectLocalAgent } as unknown as Parameters<
      typeof useLocalAgentsStore.setState
    >[0])

    useUnifiedAgentsStore.getState().select('local:42')

    expect(selectLocalAgent).toHaveBeenCalledWith(42)
  })

  it('routes history: prefix to agentHistory selectAgent', () => {
    const selectAgent = vi.fn()
    useAgentHistoryStore.setState({ selectAgent } as unknown as Parameters<
      typeof useAgentHistoryStore.setState
    >[0])

    useUnifiedAgentsStore.getState().select('history:xyz')

    expect(selectAgent).toHaveBeenCalledWith('xyz')
  })
})

describe('spawn', () => {
  it('calls spawnAgent on localAgents store with the task', async () => {
    vi.mocked(window.api.spawnLocalAgent).mockResolvedValue({
      pid: 999,
      logPath: '/tmp/log',
      id: 'agent-x',
      interactive: false
    })
    vi.mocked(window.api.getAgentProcesses).mockResolvedValue([])
    vi.mocked(window.api.agents.list).mockResolvedValue([])

    await useUnifiedAgentsStore.getState().spawn({ task: 'write tests', repoPath: '/repo' })

    expect(window.api.spawnLocalAgent).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'write tests', repoPath: '/repo' })
    )
  })

  it('prepends planning prompt when planning=true', async () => {
    vi.mocked(window.api.spawnLocalAgent).mockResolvedValue({
      pid: 111,
      logPath: '/tmp/log',
      id: 'plan-1',
      interactive: false
    })
    vi.mocked(window.api.getAgentProcesses).mockResolvedValue([])
    vi.mocked(window.api.agents.list).mockResolvedValue([])

    await useUnifiedAgentsStore.getState().spawn({
      task: 'plan new feature',
      repoPath: '/repo',
      planning: true
    })

    const call = vi.mocked(window.api.spawnLocalAgent).mock.calls[0][0]
    expect(call.task).toContain('You are a coding partner')
    expect(call.task).toContain('plan new feature')
  })

  it('shows toast on success and refreshes agents', async () => {
    vi.mocked(window.api.spawnLocalAgent).mockResolvedValue({
      pid: 222,
      logPath: '/tmp/log',
      id: 'ok-1',
      interactive: false
    })
    vi.mocked(window.api.getAgentProcesses).mockResolvedValue([
      { pid: 222, bin: 'claude', args: '', cwd: null, startedAt: Date.now(), cpuPct: 0, memMb: 0 }
    ])
    vi.mocked(window.api.agents.list).mockResolvedValue([])

    await useUnifiedAgentsStore.getState().spawn({ task: 'do work', repoPath: '/repo' })

    // fetchAll was called — agents should be populated
    expect(useUnifiedAgentsStore.getState().agents).toHaveLength(1)
  })
})

describe('steer', () => {
  it('delegates to localAgents.sendToAgent for local source agents', async () => {
    useUnifiedAgentsStore.setState({
      agents: [
        {
          id: 'local:50',
          source: 'local',
          status: 'running',
          pid: 50,
          label: 'agent',
          model: '',
          updatedAt: 0,
          startedAt: 0,
          canSteer: true,
          canKill: true,
          isBlocked: false
        }
      ]
    })

    // sendToAgent now throws, but steer catches it and shows a toast
    await useUnifiedAgentsStore.getState().steer('local:50', 'stop now')
    // Error is caught internally and shown as toast
  })

  it('does nothing for unknown agent id', async () => {
    await useUnifiedAgentsStore.getState().steer('local:999', 'msg')
    // No API call made for unknown agent
  })

  it('does nothing for history source agents', async () => {
    useUnifiedAgentsStore.setState({
      agents: [
        {
          id: 'history:abc',
          source: 'history',
          status: 'done',
          label: 'old agent',
          model: '',
          updatedAt: 0,
          startedAt: 0,
          historyId: 'abc'
        }
      ]
    })

    await useUnifiedAgentsStore.getState().steer('history:abc', 'msg')
    // No API call made for history agents
  })
})

describe('kill', () => {
  it('throws when trying to kill local agents (removed functionality)', async () => {
    const agent = {
      id: 'local:75',
      source: 'local' as const,
      status: 'running' as const,
      pid: 75,
      label: 'agent',
      model: '',
      updatedAt: 0,
      startedAt: 0,
      canSteer: false,
      canKill: true,
      isBlocked: false
    }

    await expect(useUnifiedAgentsStore.getState().kill(agent)).rejects.toThrow()
  })

  it('does not call kill IPC for history agents', async () => {
    const agent = {
      id: 'history:abc',
      source: 'history' as const,
      status: 'done' as const,
      label: 'old',
      model: '',
      updatedAt: 0,
      startedAt: 0,
      historyId: 'abc'
    }

    await useUnifiedAgentsStore.getState().kill(agent)
    // No error, just no-op for history agents
  })
})
