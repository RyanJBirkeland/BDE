import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../agent-event-mapper', () => ({
  mapRawMessage: vi.fn().mockReturnValue([]),
  emitAgentEvent: vi.fn(),
  flushAgentEventBatcher: vi.fn()
}))

// Shared spy + queue for the detector mock. Tests push a hit into
// `detectorHits` via `detectorOnMessage.mockReturnValueOnce(...)`.
const detectorOnMessage = vi.fn().mockReturnValue(null)

vi.mock('../playground-handler', () => ({
  createPlaygroundDetector: vi.fn(() => ({ onMessage: detectorOnMessage })),
  detectPlaygroundWrite: vi.fn().mockReturnValue(null)
}))

vi.mock('../../env-utils', () => ({
  invalidateOAuthToken: vi.fn(),
  refreshOAuthTokenFromKeychain: vi.fn().mockResolvedValue(true)
}))

// TurnTracker is not mocked — pass a stub object to avoid SQLite access.

import {
  consumeMessages,
  OAuthRefreshFailedError,
  __setStallTimeoutMsForTesting,
  __resetStallTimeoutForTesting
} from '../message-consumer'
import type { ActiveAgent, AgentHandle } from '../types'
import type { AgentRunClaim } from '../run-agent'
import type { TurnTracker } from '../turn-tracker'
import { emitAgentEvent, flushAgentEventBatcher } from '../../agent-event-mapper'
import { invalidateOAuthToken, refreshOAuthTokenFromKeychain } from '../../env-utils'
// detectorOnMessage is the shared spy declared at the top of this file —
// tests push a hit into it via `detectorOnMessage.mockReturnValueOnce(...)`.

function makeTurnTracker(): TurnTracker {
  return {
    processMessage: vi.fn(),
    totals: vi.fn().mockReturnValue({
      tokensIn: 0,
      tokensOut: 0,
      turnCount: 0,
      cacheTokensRead: 0,
      cacheTokensCreated: 0
    })
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
    worktreePath: '/tmp/worktrees/task-1',
    branch: 'agent/task-1',
    ...overrides
  }
}

function makeTask(overrides: Partial<AgentRunClaim> = {}): AgentRunClaim {
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
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }
}

describe('consumeMessages', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns exitCode from exit_code message', async () => {
    const handle = makeHandle([{ type: 'exit_code', exit_code: 0 }])
    const agent = makeAgent()
    const result = await consumeMessages(
      handle,
      agent,
      makeTask(),
      'run-1',
      makeTurnTracker(),
      makeLogger(),
      20
    )
    expect(result.exitCode).toBe(0)
    expect(result.streamError).toBeUndefined()
    expect(result.pendingPlaygroundPaths).toEqual([])
  })

  it('returns undefined exitCode when no exit_code message', async () => {
    const handle = makeHandle([{ type: 'assistant', text: 'hello' }])
    const agent = makeAgent()
    const result = await consumeMessages(
      handle,
      agent,
      makeTask(),
      'run-1',
      makeTurnTracker(),
      makeLogger(),
      20
    )
    expect(result.exitCode).toBeUndefined()
  })

  it('returns streamError when message iteration throws', async () => {
    const err = new Error('Stream broke')
    const handle = makeErrorHandle(err)
    const agent = makeAgent()
    const logger = makeLogger()
    const result = await consumeMessages(
      handle,
      agent,
      makeTask(),
      'run-1',
      makeTurnTracker(),
      logger
    )
    expect(result.streamError).toBeInstanceOf(Error)
    expect(result.streamError?.message).toBe('Stream broke')
  })

  it('emits agent:error event on stream error', async () => {
    const handle = makeErrorHandle(new Error('Connection reset'))
    const agent = makeAgent()
    await consumeMessages(handle, agent, makeTask(), 'run-1', makeTurnTracker(), makeLogger())
    expect(emitAgentEvent).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        type: 'agent:error',
        message: expect.stringContaining('Stream interrupted:')
      })
    )
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
    const result = await consumeMessages(
      handle,
      agent,
      makeTask(),
      'run-1',
      makeTurnTracker(),
      makeLogger()
    )
    expect(invalidateOAuthToken).toHaveBeenCalled()
    expect(refreshOAuthTokenFromKeychain).toHaveBeenCalled()
    // Result is fully settled before assertions — refresh was awaited in-band.
    expect(result).toBeDefined()
  })

  describe('OAuth refresh on auth error', () => {
    it('returns no streamError when refresh succeeds', async () => {
      vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(true)
      const handle = makeErrorHandle(new Error('Invalid API key'))
      const agent = makeAgent()
      const result = await consumeMessages(
        handle,
        agent,
        makeTask(),
        'run-1',
        makeTurnTracker(),
        makeLogger()
      )
      expect(result.streamError).toBeUndefined()
    })

    it('aborts handle and returns OAuthRefreshFailedError when refresh returns false', async () => {
      vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(false)
      const handle = makeErrorHandle(new Error('Invalid API key'))
      const agent = makeAgent()
      const result = await consumeMessages(
        handle,
        agent,
        makeTask(),
        'run-1',
        makeTurnTracker(),
        makeLogger()
      )
      expect(handle.abort).toHaveBeenCalledTimes(1)
      expect(result.streamError).toBeInstanceOf(OAuthRefreshFailedError)
      expect(emitAgentEvent).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ type: 'agent:error', message: expect.stringContaining('Stream interrupted:') })
      )
      expect(flushAgentEventBatcher).toHaveBeenCalled()
    })

    it('aborts handle and returns OAuthRefreshFailedError when refresh throws', async () => {
      vi.mocked(refreshOAuthTokenFromKeychain).mockRejectedValue(new Error('Keychain unavailable'))
      const handle = makeErrorHandle(new Error('Invalid API key'))
      const agent = makeAgent()
      const result = await consumeMessages(
        handle,
        agent,
        makeTask(),
        'run-1',
        makeTurnTracker(),
        makeLogger()
      )
      expect(handle.abort).toHaveBeenCalledTimes(1)
      expect(result.streamError).toBeInstanceOf(OAuthRefreshFailedError)
      expect(emitAgentEvent).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ type: 'agent:error', message: expect.stringContaining('Stream interrupted:') })
      )
      expect(flushAgentEventBatcher).toHaveBeenCalled()
    })

    it('calls onOAuthRefreshStart callback on refresh success', async () => {
      vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(true)
      const handle = makeErrorHandle(new Error('Invalid API key'))
      const agent = makeAgent()
      const onOAuthRefreshStart = vi.fn()
      await consumeMessages(
        handle,
        agent,
        makeTask(),
        'run-1',
        makeTurnTracker(),
        makeLogger(),
        20,
        onOAuthRefreshStart
      )
      expect(onOAuthRefreshStart).toHaveBeenCalledTimes(1)
      // Callback receives a pre-settled promise.
      const receivedPromise = onOAuthRefreshStart.mock.calls[0][0]
      await expect(receivedPromise).resolves.toBeUndefined()
    })

    it('calls onOAuthRefreshStart callback on refresh failure', async () => {
      vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(false)
      const handle = makeErrorHandle(new Error('Invalid API key'))
      const agent = makeAgent()
      const onOAuthRefreshStart = vi.fn()
      await consumeMessages(
        handle,
        agent,
        makeTask(),
        'run-1',
        makeTurnTracker(),
        makeLogger(),
        20,
        onOAuthRefreshStart
      )
      expect(onOAuthRefreshStart).toHaveBeenCalledTimes(1)
      const receivedPromise = onOAuthRefreshStart.mock.calls[0][0]
      await expect(receivedPromise).resolves.toBeUndefined()
    })

    it('completes without throwing when onOAuthRefreshStart is absent', async () => {
      vi.mocked(refreshOAuthTokenFromKeychain).mockResolvedValue(true)
      const handle = makeErrorHandle(new Error('Invalid API key'))
      const agent = makeAgent()
      await expect(
        consumeMessages(handle, agent, makeTask(), 'run-1', makeTurnTracker(), makeLogger(), 20)
      ).resolves.toBeDefined()
    })
  })

  it('increments rateLimitCount on rate_limit messages', async () => {
    const handle = makeHandle([{ type: 'system', subtype: 'rate_limit' }])
    const agent = makeAgent()
    await consumeMessages(handle, agent, makeTask(), 'run-1', makeTurnTracker(), makeLogger())
    expect(agent.rateLimitCount).toBe(1)
  })

  it('accumulates playground paths when playground_enabled', async () => {
    detectorOnMessage.mockReturnValueOnce({
      path: '/worktree/output.html',
      contentType: 'html'
    })
    const handle = makeHandle([{ type: 'tool_result', tool_name: 'write_file' }])
    const agent = makeAgent()
    const result = await consumeMessages(
      handle,
      agent,
      makeTask({ playground_enabled: true }),
      'run-1',
      makeTurnTracker(),
      makeLogger()
    )
    expect(result.pendingPlaygroundPaths).toContainEqual({
      path: '/worktree/output.html',
      contentType: 'html'
    })
  })

  it('does not accumulate playground paths when playground disabled', async () => {
    detectorOnMessage.mockReturnValueOnce({
      path: '/worktree/output.html',
      contentType: 'html'
    })
    const handle = makeHandle([{ type: 'tool_result', tool_name: 'write_file' }])
    const agent = makeAgent()
    const result = await consumeMessages(
      handle,
      agent,
      makeTask({ playground_enabled: false }),
      'run-1',
      makeTurnTracker(),
      makeLogger()
    )
    expect(result.pendingPlaygroundPaths).toHaveLength(0)
  })

  it('updates lastAgentOutput from assistant text messages', async () => {
    const handle = makeHandle([{ type: 'assistant', text: 'I have completed the task.' }])
    const agent = makeAgent()
    const result = await consumeMessages(
      handle,
      agent,
      makeTask(),
      'run-1',
      makeTurnTracker(),
      makeLogger(),
      20
    )
    expect(result.lastAgentOutput).toBe('I have completed the task.')
  })

  it('aborts when cost exceeds maxCostUsd mid-stream', async () => {
    const handle = makeHandle([
      { type: 'assistant', text: 'Turn 1', cost_usd: 0.5 },
      { type: 'assistant', text: 'Turn 2', cost_usd: 1.5 },
      { type: 'assistant', text: 'Turn 3', cost_usd: 2.1 }
    ])
    const agent = makeAgent({ maxCostUsd: 2.0 })
    const logger = makeLogger()
    const result = await consumeMessages(
      handle,
      agent,
      makeTask(),
      'run-1',
      makeTurnTracker(),
      logger
    )
    expect(handle.abort).toHaveBeenCalled()
    expect(result.streamError).toBeInstanceOf(Error)
    expect(result.streamError?.message).toContain('Cost budget $2.00 exceeded')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Cost budget $2.00 exceeded ($2.10 spent)')
    )
    expect(emitAgentEvent).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        type: 'agent:error',
        message: expect.stringContaining('Cost budget $2.00 exceeded')
      })
    )
    expect(flushAgentEventBatcher).toHaveBeenCalled()
  })

  it('does not abort when maxCostUsd is null', async () => {
    const handle = makeHandle([
      { type: 'assistant', text: 'Turn 1', cost_usd: 0.5 },
      { type: 'assistant', text: 'Turn 2', cost_usd: 10.0 }
    ])
    const agent = makeAgent({ maxCostUsd: null })
    const result = await consumeMessages(
      handle,
      agent,
      makeTask(),
      'run-1',
      makeTurnTracker(),
      makeLogger(),
      20
    )
    expect(handle.abort).not.toHaveBeenCalled()
    expect(result.streamError).toBeUndefined()
    expect(agent.costUsd).toBe(10.0)
  })

  it('aborts with max_turns_exceeded when turn count exceeds maxTurns', async () => {
    const messages = Array.from({ length: 22 }, (_, i) => ({
      type: 'assistant',
      text: `Turn ${i + 1}`
    }))
    const handle = makeHandle(messages)
    const agent = makeAgent({ maxCostUsd: null })
    const logger = makeLogger()
    const result = await consumeMessages(
      handle,
      agent,
      makeTask(),
      'run-1',
      makeTurnTracker(),
      logger,
      20
    )
    expect(handle.abort).toHaveBeenCalled()
    expect(result.streamError).toBeInstanceOf(Error)
    expect(result.streamError?.message).toBe('max_turns_exceeded')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('maxTurns (20) reached'))
    expect(emitAgentEvent).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        type: 'agent:error',
        message: 'max_turns_exceeded'
      })
    )
    expect(flushAgentEventBatcher).toHaveBeenCalled()
  })

  describe('stall detection', () => {
    // Use the real system clock — stall detection uses `node:timers` (bypasses
    // fake-timer patching) so we inject a very small timeout and wait on real time.
    const FAST_STALL_MS = 50

    beforeEach(() => __setStallTimeoutMsForTesting(FAST_STALL_MS))
    afterEach(() => __resetStallTimeoutForTesting())

    it(
      'resolves with streamError reason stalled when stream yields no message within deadline',
      async () => {
        // An async generator that hangs indefinitely — never yields, never throws.
        const hangingHandle: AgentHandle = {
          messages: {
            [Symbol.asyncIterator]() {
              return {
                next(): Promise<IteratorResult<unknown>> {
                  return new Promise(() => {}) // never resolves
                }
              }
            }
          },
          sessionId: 'test-session',
          abort: vi.fn(),
          steer: vi.fn()
        }

        const agent = makeAgent({ maxCostUsd: null })
        const logger = makeLogger()
        const task = makeTask()

        const result = await consumeMessages(
          hangingHandle,
          agent,
          task,
          'run-1',
          makeTurnTracker(),
          logger,
          20
        )

        expect(result.streamError).toBeInstanceOf(Error)
        expect(result.streamError?.message).toBe('stream_stalled')
        expect(logger.event).toHaveBeenCalledWith(
          'agent.stream.error',
          expect.objectContaining({ reason: 'stalled', taskId: task.id })
        )
        expect(emitAgentEvent).toHaveBeenCalledWith(
          'run-1',
          expect.objectContaining({ type: 'agent:error' })
        )
        expect(flushAgentEventBatcher).toHaveBeenCalled()
      },
      // generous wall-clock budget: FAST_STALL_MS + async overhead
      FAST_STALL_MS + 2000
    )
  })
})
