import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../env-utils', () => ({
  invalidateOAuthToken: vi.fn(),
  refreshOAuthTokenFromKeychain: vi.fn().mockResolvedValue(true),
  buildAgentEnvWithAuth: vi.fn().mockResolvedValue({}),
  getClaudeCliPath: vi.fn().mockResolvedValue('/usr/bin/claude')
}))
vi.mock('../agent-event-mapper', () => ({
  mapRawMessage: vi.fn().mockReturnValue([]),
  emitAgentEvent: vi.fn(),
  flushAgentEventBatcher: vi.fn()
}))
vi.mock('../playground-handler', () => ({
  createPlaygroundDetector: vi.fn(() => ({ onMessage: vi.fn().mockReturnValue(null) }))
}))
vi.mock('../../broadcast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../broadcast')>()
  return { ...actual, broadcast: vi.fn(), broadcastCoalesced: vi.fn() }
})

import { invalidateOAuthToken, refreshOAuthTokenFromKeychain } from '../../env-utils'
import { consumeMessages } from '../message-consumer'
import type { AgentHandle, ActiveAgent } from '../types'
import type { AgentRunClaim } from '../run-agent'
import { TurnTracker } from '../turn-tracker'
import type { Logger } from '../../logger'

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() } as never
}

function makeThrowingHandle(err: Error): AgentHandle {
  return {
    messages: {
      [Symbol.asyncIterator]() {
        return {
          next: vi.fn().mockRejectedValue(err)
        }
      }
    },
    abort: vi.fn(),
    steer: vi.fn().mockResolvedValue({ delivered: true })
  } as never
}

function makeDoneHandle(): AgentHandle {
  return {
    messages: {
      [Symbol.asyncIterator]() {
        return {
          next: vi.fn().mockResolvedValue({ value: undefined, done: true })
        }
      }
    },
    abort: vi.fn(),
    steer: vi.fn().mockResolvedValue({ delivered: true })
  } as never
}

function makeAgent(): ActiveAgent {
  return {
    taskId: 't1', agentRunId: 'run-1', model: 'test',
    startedAt: Date.now(), lastOutputAt: Date.now(),
    rateLimitCount: 0, costUsd: 0, tokensIn: 0, tokensOut: 0,
    handle: {} as never, worktreePath: '', branch: '',
    maxCostUsd: null
  }
}

function makeTask(): AgentRunClaim {
  return { id: 't1', title: 'test', repo: 'bde', spec: null, prompt: null, status: 'active' } as never
}

describe('oauth-refresh-coordination (T-55)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls onOAuthRefreshStart with the refresh promise on auth error', async () => {
    const handle = makeThrowingHandle(new Error('Invalid API key'))
    const onOAuthRefreshStart = vi.fn()

    await consumeMessages(
      handle,
      makeAgent(),
      makeTask(),
      'run-1',
      new TurnTracker(),
      makeLogger(),
      20,
      onOAuthRefreshStart
    )

    expect(invalidateOAuthToken).toHaveBeenCalled()
    expect(refreshOAuthTokenFromKeychain).toHaveBeenCalled()
    expect(onOAuthRefreshStart).toHaveBeenCalledOnce()
    expect(onOAuthRefreshStart).toHaveBeenCalledWith(expect.any(Promise))
  })

  it('calls onOAuthRefreshStart on invalid_api_key error', async () => {
    const handle = makeThrowingHandle(new Error('invalid_api_key — token expired'))
    const onOAuthRefreshStart = vi.fn()

    await consumeMessages(
      handle,
      makeAgent(),
      makeTask(),
      'run-1',
      new TurnTracker(),
      makeLogger(),
      20,
      onOAuthRefreshStart
    )

    expect(onOAuthRefreshStart).toHaveBeenCalledOnce()
  })

  it('does not call onOAuthRefreshStart when stream ends cleanly', async () => {
    const handle = makeDoneHandle()
    const onOAuthRefreshStart = vi.fn()

    await consumeMessages(
      handle,
      makeAgent(),
      makeTask(),
      'run-1',
      new TurnTracker(),
      makeLogger(),
      20,
      onOAuthRefreshStart
    )

    expect(onOAuthRefreshStart).not.toHaveBeenCalled()
    expect(invalidateOAuthToken).not.toHaveBeenCalled()
  })

  it('does not call onOAuthRefreshStart on non-auth stream errors', async () => {
    const handle = makeThrowingHandle(new Error('network timeout'))
    const onOAuthRefreshStart = vi.fn()

    await consumeMessages(
      handle,
      makeAgent(),
      makeTask(),
      'run-1',
      new TurnTracker(),
      makeLogger(),
      20,
      onOAuthRefreshStart
    )

    expect(onOAuthRefreshStart).not.toHaveBeenCalled()
    expect(invalidateOAuthToken).not.toHaveBeenCalled()
  })
})
