import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../agent-event-mapper', () => ({
  mapRawMessage: vi.fn().mockReturnValue([]),
  emitAgentEvent: vi.fn(),
  flushAgentEventBatcher: vi.fn()
}))

vi.mock('../playground-handler', () => ({
  detectHtmlWrite: vi.fn().mockReturnValue(null)
}))

vi.mock('../../env-utils', () => ({
  invalidateOAuthToken: vi.fn(),
  refreshOAuthTokenFromKeychain: vi.fn().mockResolvedValue(false)
}))

// TurnTracker is not mocked — pass a stub object to avoid SQLite access.

import { consumeMessages } from '../message-consumer'
import type { ActiveAgent, AgentHandle } from '../types'
import type { RunAgentTask } from '../run-agent'
import type { TurnTracker } from '../turn-tracker'
import { emitAgentEvent, flushAgentEventBatcher } from '../../agent-event-mapper'
import { invalidateOAuthToken } from '../../env-utils'
import { detectHtmlWrite } from '../playground-handler'

function makeTurnTracker(): TurnTracker {
  return {
    processMessage: vi.fn(),
    totals: vi.fn().mockReturnValue({ tokensIn: 0, tokensOut: 0, turnCount: 0, cacheTokensRead: 0, cacheTokensCreated: 0 })
  } as unknown as TurnTracker
}

function makeAgent(overrides: Partial<ActiveAgent> = {}): ActiveAgent {
  return {
    taskId: 'task-1',
    agentRunId: 'run-1',
    handle: null as unknown as AgentHandle,
    model: 'sonnet',
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    rateLimitCount: 0,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    maxRuntimeMs: null,
    maxCostUsd: null,
    ...overrides
  }
}

function makeTask(overrides: Partial<RunAgentTask> = {}): RunAgentTask {
  return {
    id: 'task-1',
    title: 'Test',
    prompt: 'Do it',
    spec: null,
    repo: 'bde',
    retry_count: 0,
    fast_fail_count: 0,
    ...overrides
  }
}

function makeHandle(messages: unknown[]): AgentHandle {
  return {
    messages: {
      async *[Symbol.asyncIterator]() {
        for (const m of messages) yield m
      }
    },
    sessionId: 'test-session',
    abort: vi.fn(),
    steer: vi.fn()
  }
}

function makeErrorHandle(err: Error): AgentHandle {
  return {
    messages: {
      async *[Symbol.asyncIterator]() {
        throw err
      }
    },
    sessionId: 'test-session',
    abort: vi.fn(),
    steer: vi.fn()
  }
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

describe('consumeMessages', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns exitCode from exit_code message', async () => {
    const handle = makeHandle([{ type: 'exit_code', exit_code: 0 }])
    const agent = makeAgent()
    const result = await consumeMessages(handle, agent, makeTask(), 'run-1', makeTurnTracker(), makeLogger())
    expect(result.exitCode).toBe(0)
    expect(result.streamError).toBeUndefined()
    expect(result.pendingPlaygroundPaths).toEqual([])
  })

  it('returns undefined exitCode when no exit_code message', async () => {
    const handle = makeHandle([{ type: 'assistant', text: 'hello' }])
    const agent = makeAgent()
    const result = await consumeMessages(handle, agent, makeTask(), 'run-1', makeTurnTracker(), makeLogger())
    expect(result.exitCode).toBeUndefined()
  })

  it('returns streamError when message iteration throws', async () => {
    const err = new Error('Stream broke')
    const handle = makeErrorHandle(err)
    const agent = makeAgent()
    const logger = makeLogger()
    const result = await consumeMessages(handle, agent, makeTask(), 'run-1', makeTurnTracker(), logger)
    expect(result.streamError).toBeInstanceOf(Error)
    expect(result.streamError?.message).toBe('Stream broke')
  })

  it('emits agent:error event on stream error', async () => {
    const handle = makeErrorHandle(new Error('Connection reset'))
    const agent = makeAgent()
    await consumeMessages(handle, agent, makeTask(), 'run-1', makeTurnTracker(), makeLogger())
    expect(emitAgentEvent).toHaveBeenCalledWith('run-1', expect.objectContaining({
      type: 'agent:error',
      message: expect.stringContaining('Stream interrupted:')
    }))
  })

  it('flushes event batcher on stream error', async () => {
    const handle = makeErrorHandle(new Error('Broken'))
    const agent = makeAgent()
    await consumeMessages(handle, agent, makeTask(), 'run-1', makeTurnTracker(), makeLogger())
    expect(flushAgentEventBatcher).toHaveBeenCalled()
  })

  it('invalidates OAuth token on Invalid API key error', async () => {
    const handle = makeErrorHandle(new Error('Invalid API key'))
    const agent = makeAgent()
    await consumeMessages(handle, agent, makeTask(), 'run-1', makeTurnTracker(), makeLogger())
    expect(invalidateOAuthToken).toHaveBeenCalled()
  })

  it('increments rateLimitCount on rate_limit messages', async () => {
    const handle = makeHandle([{ type: 'system', subtype: 'rate_limit' }])
    const agent = makeAgent()
    await consumeMessages(handle, agent, makeTask(), 'run-1', makeTurnTracker(), makeLogger())
    expect(agent.rateLimitCount).toBe(1)
  })

  it('accumulates playground paths when playground_enabled', async () => {
    vi.mocked(detectHtmlWrite).mockReturnValueOnce('/worktree/output.html')
    const handle = makeHandle([{ type: 'tool_result', tool_name: 'write_file' }])
    const agent = makeAgent()
    const result = await consumeMessages(handle, agent, makeTask({ playground_enabled: true }), 'run-1', makeTurnTracker(), makeLogger())
    expect(result.pendingPlaygroundPaths).toContain('/worktree/output.html')
  })

  it('does not accumulate playground paths when playground disabled', async () => {
    vi.mocked(detectHtmlWrite).mockReturnValueOnce('/worktree/output.html')
    const handle = makeHandle([{ type: 'tool_result', tool_name: 'write_file' }])
    const agent = makeAgent()
    const result = await consumeMessages(handle, agent, makeTask({ playground_enabled: false }), 'run-1', makeTurnTracker(), makeLogger())
    expect(result.pendingPlaygroundPaths).toHaveLength(0)
  })

  it('updates lastAgentOutput from assistant text messages', async () => {
    const handle = makeHandle([{ type: 'assistant', text: 'I have completed the task.' }])
    const agent = makeAgent()
    const result = await consumeMessages(handle, agent, makeTask(), 'run-1', makeTurnTracker(), makeLogger())
    expect(result.lastAgentOutput).toBe('I have completed the task.')
  })
})
