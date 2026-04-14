import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  subscribeToAgentEvents, getAgentEventHistory,
  listAgents, readAgentLog, importAgent, getProcesses, spawnLocal, tailLog
} from '../agents'

describe('agents service', () => {
  beforeEach(() => {
    const events = window.api.agents.events as unknown as Record<string, ReturnType<typeof vi.fn>>
    events.onEvent.mockReturnValue(() => {})
    events.getHistory.mockResolvedValue([])
    const api = window.api.agents as unknown as Record<string, ReturnType<typeof vi.fn>>
    api.list.mockResolvedValue([])
    api.readLog.mockResolvedValue({ lines: [], nextByte: 0 })
    api.import.mockResolvedValue(undefined)
    api.getProcesses.mockResolvedValue([])
    api.spawnLocal.mockResolvedValue({ ok: true })
    api.tailLog.mockResolvedValue(undefined)
  })

  it('subscribeToAgentEvents delegates to window.api.agents.events.onEvent', () => {
    const handler = vi.fn()
    subscribeToAgentEvents(handler)
    expect(window.api.agents.events.onEvent).toHaveBeenCalledWith(handler)
  })

  it('getAgentEventHistory passes agentId', async () => {
    await getAgentEventHistory('agent-1')
    expect(window.api.agents.events.getHistory).toHaveBeenCalledWith('agent-1')
  })

  it('listAgents passes limit option', async () => {
    await listAgents({ limit: 10 })
    expect(window.api.agents.list).toHaveBeenCalledWith({ limit: 10 })
  })

  it('spawnLocal passes args', async () => {
    const args = { repo: 'bde', prompt: 'do thing' } as Parameters<typeof window.api.agents.spawnLocal>[0]
    await spawnLocal(args)
    expect(window.api.agents.spawnLocal).toHaveBeenCalledWith(args)
  })
})
