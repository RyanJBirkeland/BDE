/**
 * Agent handler unit tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

// Mock ipc-utils first
vi.mock('../../ipc-utils', () => ({
  safeHandle: vi.fn()
}))

// Mock agent-log-manager
vi.mock('../../agent-log-manager', () => ({
  tailAgentLog: vi.fn(),
  cleanupOldLogs: vi.fn()
}))

// Mock agent-history
vi.mock('../../agent-history', () => ({
  listAgents: vi.fn(),
  readLog: vi.fn(),
  importAgent: vi.fn(),
  pruneOldAgents: vi.fn()
}))

// Mock adhoc-agent
vi.mock('../../adhoc-agent', () => ({
  spawnAdhocAgent: vi.fn(),
  getAdhocHandle: vi.fn()
}))

// Mock data/event-queries (used lazily in agent:history)
vi.mock('../../data/event-queries', () => ({
  getEventHistory: vi.fn(),
  appendEvent: vi.fn()
}))

// Mock db (used lazily in agent:history)
vi.mock('../../db', () => ({
  getDb: vi.fn().mockReturnValue({})
}))

import { registerAgentHandlers } from '../agent-handlers'
import { safeHandle } from '../../ipc-utils'
import { cleanupOldLogs } from '../../agent-log-manager'
import { listAgents, readLog, pruneOldAgents } from '../../agent-history'
import { spawnAdhocAgent, getAdhocHandle } from '../../adhoc-agent'
import { getEventHistory } from '../../data/event-queries'

const mockEvent = {} as IpcMainInvokeEvent

function captureHandler(channel: string, am?: any): (...args: any[]) => any {
  let captured: ((...args: any[]) => any) | undefined

  vi.mocked(safeHandle).mockImplementation((ch, handler) => {
    if (ch === channel) captured = handler as (...args: any[]) => any
  })

  registerAgentHandlers(am)

  if (!captured) throw new Error(`No handler captured for channel "${channel}"`)
  return captured
}

describe('registerAgentHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers expected channels', () => {
    registerAgentHandlers()
    const channels = vi.mocked(safeHandle).mock.calls.map(([ch]) => ch)
    expect(channels).toContain('local:getAgentProcesses')
    expect(channels).toContain('local:spawnClaudeAgent')
    expect(channels).toContain('local:tailAgentLog')
    expect(channels).toContain('agent:steer')
    expect(channels).toContain('agent:kill')
    expect(channels).toContain('agent:history')
    expect(channels).toContain('agents:list')
    expect(channels).toContain('agents:readLog')
    expect(channels).toContain('agents:import')
  })

  it('calls cleanupOldLogs and pruneOldAgents on registration', () => {
    registerAgentHandlers()
    expect(cleanupOldLogs).toHaveBeenCalled()
    expect(pruneOldAgents).toHaveBeenCalled()
  })
})

describe('agents:list handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns list of agents', async () => {
    const agents = [
      { id: 'agent-1', status: 'done', task: 'Build feature' },
      { id: 'agent-2', status: 'active', task: 'Fix bug' }
    ]
    vi.mocked(listAgents).mockResolvedValue(agents as any)

    const handler = captureHandler('agents:list')
    const result = await handler(mockEvent, { limit: 10 })

    expect(listAgents).toHaveBeenCalledWith(10, undefined)
    expect(result).toEqual(agents)
  })

  it('filters by status when provided', async () => {
    const agents = [{ id: 'agent-3', status: 'active' }]
    vi.mocked(listAgents).mockResolvedValue(agents as any)

    const handler = captureHandler('agents:list')
    const result = await handler(mockEvent, { limit: 5, status: 'active' })

    expect(listAgents).toHaveBeenCalledWith(5, 'active')
    expect(result).toEqual(agents)
  })
})

describe('agents:readLog handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns log content from agent history', async () => {
    vi.mocked(readLog).mockResolvedValue({ content: 'log output', nextByte: 10, totalBytes: 10 })

    const handler = captureHandler('agents:readLog')
    const result = await handler(mockEvent, { id: 'agent-1', fromByte: 0 })

    expect(readLog).toHaveBeenCalledWith('agent-1', 0)
    expect(result).toEqual({ content: 'log output', nextByte: 10, totalBytes: 10 })
  })

  it('reads from offset when fromByte is provided', async () => {
    vi.mocked(readLog).mockResolvedValue({ content: 'new content', nextByte: 100, totalBytes: 100 })

    const handler = captureHandler('agents:readLog')
    await handler(mockEvent, { id: 'agent-1', fromByte: 50 })

    expect(readLog).toHaveBeenCalledWith('agent-1', 50)
  })
})

describe('agent:kill handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('kills via adhoc handle when available', async () => {
    const mockHandle = { close: vi.fn(), send: vi.fn() }
    vi.mocked(getAdhocHandle).mockReturnValue(mockHandle as any)

    const handler = captureHandler('agent:kill')
    const result = await handler(mockEvent, 'adhoc-agent-1')

    expect(mockHandle.close).toHaveBeenCalled()
    expect(result).toEqual({ ok: true })
  })

  it('kills via AgentManager when no adhoc handle', async () => {
    vi.mocked(getAdhocHandle).mockReturnValue(undefined)
    const mockAm = { killAgent: vi.fn() }

    const handler = captureHandler('agent:kill', mockAm)
    const result = await handler(mockEvent, 'managed-agent-1')

    expect(mockAm.killAgent).toHaveBeenCalledWith('managed-agent-1')
    expect(result).toEqual({ ok: true })
  })

  it('returns error when no adhoc or AgentManager', async () => {
    vi.mocked(getAdhocHandle).mockReturnValue(undefined)

    const handler = captureHandler('agent:kill')
    const result = await handler(mockEvent, 'runner-agent-1')

    expect(result).toEqual({ ok: false, error: 'Agent not found' })
  })
})

describe('agent:steer handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('steers via adhoc handle when available', async () => {
    const mockHandle = { send: vi.fn().mockResolvedValue(undefined), close: vi.fn() }
    vi.mocked(getAdhocHandle).mockReturnValue(mockHandle as any)

    const handler = captureHandler('agent:steer')
    const result = await handler(mockEvent, { agentId: 'adhoc-1', message: 'Do this' })

    expect(mockHandle.send).toHaveBeenCalledWith('Do this')
    expect(result).toEqual({ ok: true })
  })

  it('steers via AgentManager when no adhoc handle', async () => {
    vi.mocked(getAdhocHandle).mockReturnValue(undefined)
    const mockAm = { steerAgent: vi.fn().mockResolvedValue({ delivered: true }) }

    const handler = captureHandler('agent:steer', mockAm)
    const result = await handler(mockEvent, { agentId: 'managed-1', message: 'Pivot' })

    expect(mockAm.steerAgent).toHaveBeenCalledWith('managed-1', 'Pivot')
    expect(result).toEqual({ ok: true })
  })

  it('returns error when no adhoc or AgentManager', async () => {
    vi.mocked(getAdhocHandle).mockReturnValue(undefined)

    const handler = captureHandler('agent:steer')
    const result = await handler(mockEvent, { agentId: 'remote-1', message: 'Hello' })

    expect(result).toEqual({ ok: false, error: 'No agent manager available' })
  })
})

describe('agent:history handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parsed event history from SQLite', async () => {
    const rows = [
      { payload: JSON.stringify({ type: 'message', text: 'Hello' }) },
      { payload: JSON.stringify({ type: 'result', exitCode: 0 }) }
    ]
    vi.mocked(getEventHistory).mockReturnValue(rows as any)

    const handler = captureHandler('agent:history')
    const result = await handler(mockEvent, 'agent-42')

    expect(getEventHistory).toHaveBeenCalledWith({}, 'agent-42')
    expect(result).toEqual([
      { type: 'message', text: 'Hello' },
      { type: 'result', exitCode: 0 }
    ])
  })

  it('returns empty array when no events exist', async () => {
    vi.mocked(getEventHistory).mockReturnValue([])

    const handler = captureHandler('agent:history')
    const result = await handler(mockEvent, 'agent-empty')

    expect(result).toEqual([])
  })
})

describe('local:spawnClaudeAgent handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to spawnAdhocAgent with correct args', async () => {
    const spawnResult = { agentId: 'new-agent-1', ok: true }
    vi.mocked(spawnAdhocAgent).mockResolvedValue(spawnResult as any)

    const handler = captureHandler('local:spawnClaudeAgent')
    const result = await handler(mockEvent, {
      task: 'Build the feature',
      repoPath: '/Users/test/projects/BDE',
      model: 'claude-opus-4'
    })

    expect(spawnAdhocAgent).toHaveBeenCalledWith({
      task: 'Build the feature',
      repoPath: '/Users/test/projects/BDE',
      model: 'claude-opus-4',
      assistant: undefined
    })
    expect(result).toEqual(spawnResult)
  })
})
