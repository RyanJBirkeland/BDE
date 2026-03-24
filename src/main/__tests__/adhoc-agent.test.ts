import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before imports
vi.mock('../agent-manager/sdk-adapter', () => ({
  spawnAgent: vi.fn(),
}))
vi.mock('../agent-history', () => ({
  importAgent: vi.fn(),
  updateAgentMeta: vi.fn(),
}))
vi.mock('../data/event-queries', () => ({
  appendEvent: vi.fn(),
}))
vi.mock('../db', () => ({
  getDb: vi.fn(() => ({})),
}))
vi.mock('../broadcast', () => ({
  broadcast: vi.fn(),
}))

import { spawnAdhocAgent } from '../adhoc-agent'
import { spawnAgent } from '../agent-manager/sdk-adapter'
import { importAgent, updateAgentMeta } from '../agent-history'
import { broadcast } from '../broadcast'

function createMockHandle(messages: unknown[] = []) {
  let aborted = false
  return {
    messages: (async function* () {
      for (const msg of messages) {
        if (aborted) return
        yield msg
      }
    })(),
    sessionId: 'test-session',
    abort() { aborted = true },
    async steer(_msg: string) {},
  }
}

describe('spawnAdhocAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(importAgent).mockResolvedValue({
      id: 'agent-1',
      pid: null,
      bin: 'claude',
      model: 'sonnet',
      repo: 'test-repo',
      repoPath: '/tmp/test-repo',
      task: 'test task',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      status: 'running',
      source: 'adhoc',
      logPath: '/tmp/logs/agent-1/log.jsonl',
    })
  })

  it('spawns agent via SDK adapter and returns result', async () => {
    const handle = createMockHandle([])
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    const result = await spawnAdhocAgent({
      task: 'fix the bug',
      repoPath: '/tmp/test-repo',
      model: 'sonnet',
    })

    expect(spawnAgent).toHaveBeenCalledWith({
      prompt: 'fix the bug',
      cwd: '/tmp/test-repo',
      model: 'sonnet',
    })
    expect(importAgent).toHaveBeenCalled()
    expect(result.id).toBe('agent-1')
    expect(result.interactive).toBe(true)
    expect(result.logPath).toBe('/tmp/logs/agent-1/log.jsonl')
  })

  it('broadcasts agent:started event', async () => {
    const handle = createMockHandle([])
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })

    // Wait for background message loop to process
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:started', model: 'sonnet' }),
    })
  })

  it('broadcasts agent:completed when messages end', async () => {
    const handle = createMockHandle([])
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:completed' }),
    })
    expect(updateAgentMeta).toHaveBeenCalledWith('agent-1', expect.objectContaining({ status: 'done' }))
  })

  it('maps assistant text messages to agent:text events', async () => {
    const handle = createMockHandle([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } },
    ])
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:text', text: 'Hello' }),
    })
  })

  it('defaults model to claude-sonnet-4-5 when not provided', async () => {
    const handle = createMockHandle([])
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r' })

    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-5' }),
    )
  })

  it('maps tool_use blocks to agent:tool_call events', async () => {
    const handle = createMockHandle([
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { path: '/tmp' } }] } },
    ])
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:tool_call', tool: 'Read' }),
    })
  })

  it('emits agent:error on message consumption failure', async () => {
    const handle = {
      messages: (async function* () { throw new Error('SDK crash') })(),
      sessionId: 'test',
      abort() {},
      async steer() {},
    }
    vi.mocked(spawnAgent).mockResolvedValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:error', message: 'SDK crash' }),
    })
  })
})
