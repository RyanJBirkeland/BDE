import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useLocalAgentsStore } from '../localAgents'

describe('localAgents store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useLocalAgentsStore.setState({
      processes: [],
      collapsed: false,
      spawnedAgents: [],
      selectedLocalAgentPid: null,
      logContent: '',
      logNextByte: 0
    })
    vi.clearAllMocks()
    // Reset queued mockResolvedValueOnce from previous tests
    vi.mocked(window.api.tailAgentLog).mockReset()
    vi.mocked(window.api.tailAgentLog).mockResolvedValue({ content: '', nextByte: 0 })
  })

  afterEach(() => {
    useLocalAgentsStore.getState().stopLogPolling()
    vi.useRealTimers()
  })

  it('fetchProcesses sets processes from getAgentProcesses', async () => {
    const mockProcs = [
      {
        pid: 100,
        bin: 'claude',
        args: '--task fix',
        cwd: '/tmp/repo',
        startedAt: Date.now(),
        cpuPct: 5,
        memMb: 120
      },
      {
        pid: 200,
        bin: 'claude',
        args: '--task test',
        cwd: '/tmp/repo2',
        startedAt: Date.now(),
        cpuPct: 3,
        memMb: 80
      }
    ]
    vi.mocked(window.api.getAgentProcesses).mockResolvedValue(mockProcs)

    await useLocalAgentsStore.getState().fetchProcesses()

    const state = useLocalAgentsStore.getState()
    expect(state.processes).toHaveLength(2)
    expect(state.processes[0].pid).toBe(100)
  })

  it('fetchProcesses silently handles errors', async () => {
    vi.mocked(window.api.getAgentProcesses).mockRejectedValue(new Error('fail'))

    await useLocalAgentsStore.getState().fetchProcesses()

    expect(useLocalAgentsStore.getState().processes).toEqual([])
  })

  it('spawnAgent calls spawnLocalAgent, adds to spawnedAgents, and persists', async () => {
    vi.mocked(window.api.spawnLocalAgent).mockResolvedValue({
      pid: 999,
      logPath: '/tmp/agent.log',
      id: 'spawn-1',
      interactive: true
    })

    const result = await useLocalAgentsStore.getState().spawnAgent({
      task: 'write tests',
      repoPath: '/tmp/repo',
      model: 'opus'
    })

    expect(result.pid).toBe(999)
    expect(result.id).toBe('spawn-1')
    expect(window.api.spawnLocalAgent).toHaveBeenCalledWith({
      task: 'write tests',
      repoPath: '/tmp/repo',
      model: 'opus'
    })

    const state = useLocalAgentsStore.getState()
    expect(state.spawnedAgents).toHaveLength(1)
    expect(state.spawnedAgents[0].task).toBe('write tests')
    expect(state.spawnedAgents[0].model).toBe('opus')
    expect(state.spawnedAgents[0].interactive).toBe(true)
  })

  it('spawnAgent defaults model to sonnet when not provided', async () => {
    vi.mocked(window.api.spawnLocalAgent).mockResolvedValue({
      pid: 888,
      logPath: '/tmp/log',
      id: 'spawn-2',
      interactive: false
    })

    await useLocalAgentsStore.getState().spawnAgent({
      task: 'fix bug',
      repoPath: '/tmp/repo'
    })

    expect(useLocalAgentsStore.getState().spawnedAgents[0].model).toBe('sonnet')
  })

  it('sendToAgent throws on { ok: false }', async () => {
    vi.mocked(window.api.sendToAgent).mockResolvedValue({ ok: false, error: 'agent busy' })

    await expect(useLocalAgentsStore.getState().sendToAgent(123, 'hello')).rejects.toThrow(
      'agent busy'
    )

    expect(window.api.sendToAgent).toHaveBeenCalledWith(123, 'hello')
  })

  it('sendToAgent resolves on { ok: true }', async () => {
    vi.mocked(window.api.sendToAgent).mockResolvedValue({ ok: true })

    await expect(useLocalAgentsStore.getState().sendToAgent(123, 'hello')).resolves.toBeUndefined()
  })

  it('killLocalAgent calls IPC and does NOT remove process (ps-poll handles that)', async () => {
    useLocalAgentsStore.setState({
      processes: [
        { pid: 100, bin: 'claude', args: '', cwd: null, startedAt: Date.now(), cpuPct: 0, memMb: 0 }
      ]
    })

    await useLocalAgentsStore.getState().killLocalAgent(100)

    expect(window.api.killLocalAgent).toHaveBeenCalledWith(100)
    // Process should still be in the list — removal happens via polling
    expect(useLocalAgentsStore.getState().processes).toHaveLength(1)
  })

  it('log polling accumulates content and advances logNextByte', async () => {
    vi.mocked(window.api.tailAgentLog)
      .mockResolvedValueOnce({ content: 'chunk1 ', nextByte: 7 })
      .mockResolvedValueOnce({ content: 'chunk2', nextByte: 13 })

    useLocalAgentsStore.getState().startLogPolling('/tmp/agent.log')

    await vi.advanceTimersByTimeAsync(0)
    expect(useLocalAgentsStore.getState().logContent).toBe('chunk1 ')
    expect(useLocalAgentsStore.getState().logNextByte).toBe(7)

    await vi.advanceTimersByTimeAsync(1000)
    expect(useLocalAgentsStore.getState().logContent).toBe('chunk1 chunk2')
    expect(useLocalAgentsStore.getState().logNextByte).toBe(13)
  })

  it('stopLogPolling prevents further log accumulation', async () => {
    vi.mocked(window.api.tailAgentLog)
      .mockResolvedValueOnce({ content: 'first ', nextByte: 6 })
      .mockResolvedValueOnce({ content: 'second', nextByte: 12 })

    useLocalAgentsStore.getState().startLogPolling('/tmp/log')

    await vi.advanceTimersByTimeAsync(0)
    expect(useLocalAgentsStore.getState().logContent).toBe('first ')

    useLocalAgentsStore.getState().stopLogPolling()

    // Content should not change after stopping
    await vi.advanceTimersByTimeAsync(2000)
    expect(useLocalAgentsStore.getState().logContent).toBe('first ')
  })

  it('selectLocalAgent resets log state and stops polling', async () => {
    vi.mocked(window.api.tailAgentLog)
      .mockResolvedValueOnce({ content: 'existing', nextByte: 8 })
      .mockResolvedValueOnce({ content: 'more', nextByte: 12 })

    useLocalAgentsStore.getState().startLogPolling('/tmp/log')
    await vi.advanceTimersByTimeAsync(0)
    expect(useLocalAgentsStore.getState().logContent).toBe('existing')

    useLocalAgentsStore.getState().selectLocalAgent(555)

    const state = useLocalAgentsStore.getState()
    expect(state.selectedLocalAgentPid).toBe(555)
    expect(state.logContent).toBe('')
    expect(state.logNextByte).toBe(0)

    // Verify polling stopped — content should not change
    await vi.advanceTimersByTimeAsync(2000)
    expect(useLocalAgentsStore.getState().logContent).toBe('')
  })
})
