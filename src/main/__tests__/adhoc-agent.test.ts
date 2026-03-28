import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before imports
const mockQuery = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args)
}))
vi.mock('../agent-history', () => ({
  importAgent: vi.fn(),
  updateAgentMeta: vi.fn()
}))
vi.mock('../data/event-queries', () => ({
  appendEvent: vi.fn()
}))
vi.mock('../db', () => ({
  getDb: vi.fn(() => ({}))
}))
vi.mock('../broadcast', () => ({
  broadcast: vi.fn()
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: vi.fn(() => false), readFileSync: vi.fn() }
})
vi.mock('../agent-manager/prompt-composer', () => ({
  buildAgentPrompt: vi.fn((input) => {
    // Mock that returns a composed prompt with preamble
    const preamble = input.agentType === 'assistant' ? '[ASSISTANT PREAMBLE]' : '[ADHOC PREAMBLE]'
    return `${preamble}\n\n${input.taskContent}`
  })
}))

import { spawnAdhocAgent } from '../adhoc-agent'
import { importAgent, updateAgentMeta } from '../agent-history'
import { broadcast } from '../broadcast'
import { buildAgentPrompt } from '../agent-manager/prompt-composer'

function createMockQueryHandle(messages: unknown[] = []) {
  const handle = {
    [Symbol.asyncIterator]: async function* () {
      for (const msg of messages) yield msg
    },
    close: vi.fn(),
    streamInput: vi.fn()
  }
  return handle
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
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      sprintTaskId: null
    } as any)
  })

  it('calls sdk.query and returns result with agent ID', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    const result = await spawnAdhocAgent({
      task: 'fix the bug',
      repoPath: '/tmp/test-repo',
      model: 'sonnet'
    })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.anything(),
        options: expect.objectContaining({ model: 'sonnet', cwd: '/tmp/test-repo' })
      })
    )
    expect(importAgent).toHaveBeenCalled()
    expect(result.id).toBe('agent-1')
    expect(result.interactive).toBe(true)
    expect(result.logPath).toBe('/tmp/logs/agent-1/log.jsonl')
  })

  it('defaults model to claude-sonnet-4-5 when not provided', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r' })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ model: 'claude-sonnet-4-5' })
      })
    )
  })

  it('broadcasts agent:started event', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:started', model: 'sonnet' })
    })
  })

  it('maps assistant text messages to agent:text events', async () => {
    const handle = createMockQueryHandle([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }
    ])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:text', text: 'Hello' })
    })
  })

  it('maps tool_use blocks to agent:tool_call events', async () => {
    const handle = createMockQueryHandle([
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { path: '/tmp' } }] }
      }
    ])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:tool_call', tool: 'Read' })
    })
  })

  it('broadcasts agent:completed when messages end', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:completed' })
    })
    expect(updateAgentMeta).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ status: 'done' })
    )
  })

  it('emits agent:error on message consumption failure', async () => {
    const handle = {
      [Symbol.asyncIterator]: async function* () {
        throw new Error('SDK crash')
      },
      close: vi.fn(),
      streamInput: vi.fn()
    }
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await new Promise((r) => setTimeout(r, 50))

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:error', message: 'SDK crash' })
    })
  })
})

describe('spawnAdhocAgent — prompt composer integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(importAgent).mockResolvedValue({
      id: 'agent-1',
      logPath: '/tmp/logs/agent-1/log.jsonl'
    } as any)
  })

  it('calls buildAgentPrompt with adhoc agentType when assistant flag is not set', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({
      task: 'fix the bug',
      repoPath: '/tmp/test-repo',
      model: 'sonnet'
    })

    expect(buildAgentPrompt).toHaveBeenCalledWith({
      agentType: 'adhoc',
      taskContent: 'fix the bug'
    })
  })

  it('calls buildAgentPrompt with assistant agentType when assistant flag is true', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({
      task: 'help me understand the codebase',
      repoPath: '/tmp/test-repo',
      model: 'sonnet',
      assistant: true
    })

    expect(buildAgentPrompt).toHaveBeenCalledWith({
      agentType: 'assistant',
      taskContent: 'help me understand the codebase'
    })
  })

  it('passes composed prompt to sdk.query initial message', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)
    vi.mocked(buildAgentPrompt).mockReturnValue('[PREAMBLE]\n\nuser task')

    await spawnAdhocAgent({
      task: 'user task',
      repoPath: '/tmp/r'
    })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.anything()
      })
    )

    // Verify the prompt generator yields a message with the composed prompt
    const call = mockQuery.mock.calls[0][0]
    const promptGen = call.prompt
    const firstMessage = await promptGen.next()
    expect(firstMessage.value.message.content).toBe('[PREAMBLE]\n\nuser task')
  })

  it('includes settingSources in SDK options', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({
      task: 'test',
      repoPath: '/tmp/r'
    })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          settingSources: ['user', 'project', 'local']
        })
      })
    )
  })
})
