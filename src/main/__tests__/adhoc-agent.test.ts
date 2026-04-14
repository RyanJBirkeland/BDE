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
vi.mock('../data/agent-queries', () => ({
  insertAgentRunTurn: vi.fn()
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
vi.mock('../lib/prompt-composer', () => ({
  buildAgentPrompt: vi.fn((input) => {
    // Mock that returns a composed prompt with preamble
    const preamble = input.agentType === 'assistant' ? '[ASSISTANT PREAMBLE]' : '[ADHOC PREAMBLE]'
    return `${preamble}\n\n${input.taskContent}`
  })
}))
// Adhoc agents now run inside an isolated git worktree (created by setupWorktree).
// The real implementation shells out to git — we mock it so unit tests don't
// need an actual repo. The mock returns a deterministic worktree path so
// assertions can inspect the cwd that gets passed to sdk.query.
const TEST_WORKTREE_PATH = '/tmp/bde-adhoc/test-repo/worktree'
const TEST_BRANCH = 'agent/test-branch-12345678'
vi.mock('../agent-manager/worktree', () => ({
  setupWorktree: vi.fn(async () => ({
    worktreePath: TEST_WORKTREE_PATH,
    branch: TEST_BRANCH
  }))
}))

import { spawnAdhocAgent, getAdhocHandle } from '../adhoc-agent'
import { importAgent, updateAgentMeta } from '../agent-history'
import { broadcast } from '../broadcast'
import { buildAgentPrompt } from '../lib/prompt-composer'
import { setupWorktree } from '../agent-manager/worktree'
import { nowIso } from '../../shared/time'

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
      startedAt: nowIso(),
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
    vi.mocked(updateAgentMeta).mockResolvedValue(undefined as any)
  })

  it('creates a worktree and uses it as cwd for the SDK query', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    const result = await spawnAdhocAgent({
      task: 'fix the bug',
      repoPath: '/tmp/test-repo',
      model: 'sonnet'
    })

    // Worktree must be created BEFORE the SDK is invoked, scoped to the
    // repo the user picked, with the agent's UUID as the taskId so the
    // worktree directory matches the agent_runs row.
    expect(setupWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: '/tmp/test-repo',
        // taskId is the freshly-allocated agent UUID — assert it's present
        // and well-formed rather than pinning a literal value.
        taskId: expect.stringMatching(/^[0-9a-f-]{36}$/)
      })
    )

    // The SDK must be invoked with the worktree path (NOT the repo path)
    // so the agent never touches the user's main checkout.
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.anything(),
        options: expect.objectContaining({ model: 'sonnet', cwd: TEST_WORKTREE_PATH })
      })
    )
    expect(importAgent).toHaveBeenCalled()
    expect(result.id).toBe('agent-1')
    expect(result.interactive).toBe(true)
    expect(result.logPath).toBe('/tmp/logs/agent-1/log.jsonl')
  })

  it('persists worktree path and branch on the agent_runs row', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({
      task: 'fix the bug',
      repoPath: '/tmp/test-repo',
      model: 'sonnet'
    })

    // The Promote handler later reads worktreePath + branch off agent_runs,
    // so they MUST be set at spawn time. Without these the Promote action
    // would have no way to find the work it's promoting.
    expect(importAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: TEST_WORKTREE_PATH,
        branch: TEST_BRANCH,
        source: 'adhoc',
        status: 'running'
      }),
      ''
    )
  })

  it('passes the branch to buildAgentPrompt so the agent knows its branch', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({
      task: 'fix the bug',
      repoPath: '/tmp/test-repo'
    })

    // The branch appendix in prompt-composer needs the branch name. Adhoc
    // agents must NOT receive a stale or empty branch — their prompt tells
    // them which branch they own.
    expect(buildAgentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: TEST_BRANCH
      })
    )
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
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalled(), { timeout: 1000 })

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
    await vi.waitFor(
      () =>
        expect(broadcast).toHaveBeenCalledWith(
          'agent:event',
          expect.objectContaining({ event: expect.objectContaining({ type: 'agent:text' }) })
        ),
      { timeout: 1000 }
    )

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
    await vi.waitFor(
      () =>
        expect(broadcast).toHaveBeenCalledWith(
          'agent:event',
          expect.objectContaining({ event: expect.objectContaining({ type: 'agent:tool_call' }) })
        ),
      { timeout: 1000 }
    )

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:tool_call', tool: 'Read' })
    })
  })

  it('broadcasts agent:completed when messages end', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    const result = await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    // Wait for the first turn to complete, then close the session to trigger completion
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalled(), { timeout: 1000 })
    getAdhocHandle(result.id)?.close()
    await vi.waitFor(
      () =>
        expect(broadcast).toHaveBeenCalledWith(
          'agent:event',
          expect.objectContaining({ event: expect.objectContaining({ type: 'agent:completed' }) })
        ),
      { timeout: 1000 }
    )

    expect(broadcast).toHaveBeenCalledWith('agent:event', {
      agentId: 'agent-1',
      event: expect.objectContaining({ type: 'agent:completed' })
    })
    expect(updateAgentMeta).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({ status: 'done' })
    )
  })

  it('accumulates tokensIn across turns (not last-wins)', async () => {
    // Each turn yields an assistant message with usage at msg.message.usage (real SDK format).
    // With last-wins the final tokensIn would be 100; with accumulation it must be 200.
    const turn1Handle = createMockQueryHandle([
      {
        type: 'assistant',
        message: { usage: { input_tokens: 100, output_tokens: 50 }, content: [] }
      }
    ])
    const turn2Handle = createMockQueryHandle([
      {
        type: 'assistant',
        message: { usage: { input_tokens: 100, output_tokens: 50 }, content: [] }
      }
    ])
    mockQuery.mockReturnValueOnce(turn1Handle).mockReturnValueOnce(turn2Handle)

    const result = await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })

    // Wait for first turn to complete
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalled(), { timeout: 1000 })

    // Run a second turn
    await getAdhocHandle(result.id)?.send('follow up')

    // Wait for second turn messages to propagate, then close to trigger completion
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2), { timeout: 1000 })
    getAdhocHandle(result.id)?.close()

    await vi.waitFor(
      () =>
        expect(broadcast).toHaveBeenCalledWith(
          'agent:event',
          expect.objectContaining({ event: expect.objectContaining({ type: 'agent:completed' }) })
        ),
      { timeout: 1000 }
    )

    const completedCall = vi
      .mocked(broadcast)
      .mock.calls.find(
        ([, payload]) =>
          typeof payload === 'object' &&
          payload !== null &&
          'event' in payload &&
          typeof payload.event === 'object' &&
          payload.event !== null &&
          (payload.event as Record<string, unknown>).type === 'agent:completed'
      )
    expect(completedCall).toBeDefined()
    const completedEvent = (completedCall![1] as { event: Record<string, unknown> }).event
    // Accumulated across 2 turns: 100 + 100 = 200, not last-wins 100
    expect(completedEvent.tokensIn).toBe(200)
  })

  it('sends multimodal SDKUserMessage when images provided and session exists', async () => {
    // First turn: establish session
    const turn1 = createMockQueryHandle([
      { type: 'system', subtype: 'init', session_id: 'sess-abc' }
    ])
    // Second turn: image steer
    const turn2 = createMockQueryHandle([])
    mockQuery.mockReturnValueOnce(turn1).mockReturnValueOnce(turn2)

    const result = await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1), { timeout: 1000 })

    // Send a steering message with an image attachment
    await getAdhocHandle(result.id)?.send('check this screenshot', [
      { data: 'aGVsbG8=', mimeType: 'image/png' }
    ])

    expect(mockQuery).toHaveBeenCalledTimes(2)
    const secondCall = mockQuery.mock.calls[1][0]

    // The prompt should be an async iterable (SDKUserMessage), NOT a plain string
    expect(typeof secondCall.prompt).not.toBe('string')
    expect(secondCall.options).toMatchObject({ resume: 'sess-abc' })

    // Consume the iterable to inspect message content
    const messages = []
    for await (const msg of secondCall.prompt) {
      messages.push(msg)
    }
    expect(messages).toHaveLength(1)
    const content = messages[0].message.content
    expect(content).toContainEqual({ type: 'text', text: 'check this screenshot' })
    expect(content).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' }
    })
  })

  it('falls back to plain string when no session yet (first turn image attempt)', async () => {
    // No session established yet (no system.init consumed)
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({ task: 'test', repoPath: '/tmp/r', model: 'sonnet' })
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(1), { timeout: 1000 })

    // The first turn's prompt should be a plain string (no session_id available)
    const firstCall = mockQuery.mock.calls[0][0]
    expect(typeof firstCall.prompt).toBe('string')
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
    await vi.waitFor(
      () =>
        expect(broadcast).toHaveBeenCalledWith(
          'agent:event',
          expect.objectContaining({ event: expect.objectContaining({ type: 'agent:error' }) })
        ),
      { timeout: 1000 }
    )

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
    vi.mocked(updateAgentMeta).mockResolvedValue(undefined as any)
  })

  it('calls buildAgentPrompt with adhoc agentType when assistant flag is not set', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({
      task: 'fix the bug',
      repoPath: '/tmp/test-repo',
      model: 'sonnet'
    })

    expect(buildAgentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'adhoc',
        taskContent: 'fix the bug'
      })
    )
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

    expect(buildAgentPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'assistant',
        taskContent: 'help me understand the codebase'
      })
    )
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

    // Verify the prompt string passed to sdk.query is the composed prompt
    const call = mockQuery.mock.calls[0][0]
    expect(call.prompt).toBe('[PREAMBLE]\n\nuser task')
  })

  it('uses empty settingSources and maxBudgetUsd cap', async () => {
    const handle = createMockQueryHandle([])
    mockQuery.mockReturnValue(handle)

    await spawnAdhocAgent({
      task: 'test',
      repoPath: '/tmp/r'
    })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          // BDE conventions injected via buildAgentPrompt() — 'project' source
          // would double-inject CLAUDE.md, costing ~5-10KB extra per turn.
          settingSources: [],
          // Safety ceiling for interactive multi-turn sessions.
          maxBudgetUsd: 5.0
        })
      })
    )
  })
})
