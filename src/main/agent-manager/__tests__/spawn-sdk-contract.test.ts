/**
 * SDK wire-protocol contract tests for spawnViaSdk.
 *
 * These tests call spawnViaSdk directly with a real in-process async-generator
 * mock whose message shapes conform to SDKWireMessage. The real
 * sdk-message-protocol.ts functions (getSessionId, asSDKMessage,
 * isRateLimitMessage) run unmodified — no vi.mock on that module.
 *
 * Only env/path utilities are mocked so the tests are hermetic with respect
 * to the filesystem and process environment.
 */
import { describe, it, expect, vi } from 'vitest'
import type { SDKWireMessage } from '../sdk-message-protocol'

// ---------------------------------------------------------------------------
// Mock only env/path utilities — NOT the SDK and NOT sdk-message-protocol
// ---------------------------------------------------------------------------

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/local/bin' })),
  getOAuthToken: vi.fn(() => null),
  getClaudeCliPath: vi.fn(() => '/mock/claude')
}))

vi.mock('../resolve-node', () => ({
  resolveNodeExecutable: vi.fn(() => undefined)
}))

vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn(() => ({})),
  BDE_MEMORY_DIR: '/mock/.bde/memory'
}))

vi.mock('../worktree-isolation-hook', () => ({
  createWorktreeIsolationHook: vi.fn(() => async () => ({ behavior: 'allow' as const }))
}))

import { spawnViaSdk } from '../spawn-sdk'
import type { SpawnStrategy } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SDK_STRATEGY: SpawnStrategy = { type: 'sdk' }
const MOCK_ENV = { PATH: '/usr/local/bin' }
const NO_TOKEN = null

/**
 * Builds a minimal mock SDK whose query() returns a real async generator
 * that yields each message from the provided array.
 *
 * The generator is constructed with a real `async function*` — no vi.fn()
 * wrapping the generator itself. The mock SDK object is returned so tests
 * can pass it directly to spawnViaSdk as the first argument.
 */
function makeMockSdk(messages: unknown[]) {
  return {
    query(_opts: unknown) {
      const msgs = [...messages]
      async function* generate() {
        for (const msg of msgs) {
          yield msg
        }
      }
      return generate()
    }
  } as unknown as typeof import('@anthropic-ai/claude-agent-sdk')
}

async function collectMessages(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const results: unknown[] = []
  for await (const msg of iterable) {
    results.push(msg)
  }
  return results
}

// ---------------------------------------------------------------------------
// session_id extraction
// ---------------------------------------------------------------------------

describe('spawnViaSdk session_id extraction', () => {
  it('extracts session_id from the first system message', async () => {
    const messages: SDKWireMessage[] = [
      { type: 'system', session_id: 'real-abc' },
      { type: 'exit_code', exit_code: 0 }
    ]
    const mockSdk = makeMockSdk(messages)
    const handle = spawnViaSdk(
      mockSdk,
      { prompt: 'test', cwd: '/tmp', model: 'claude-sonnet' },
      MOCK_ENV,
      NO_TOKEN,
      SDK_STRATEGY
    )
    await collectMessages(handle.messages)
    expect(handle.sessionId).toBe('real-abc')
  })

  it('keeps UUID fallback when no message carries session_id', async () => {
    const messages: SDKWireMessage[] = [{ type: 'exit_code', exit_code: 0 }]
    const mockSdk = makeMockSdk(messages)
    const handle = spawnViaSdk(
      mockSdk,
      { prompt: 'test', cwd: '/tmp', model: 'claude-sonnet' },
      MOCK_ENV,
      NO_TOKEN,
      SDK_STRATEGY
    )
    await collectMessages(handle.messages)
    expect(handle.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('does NOT overwrite sessionId when a second message carries a different session_id', async () => {
    const messages: SDKWireMessage[] = [
      { type: 'system', session_id: 'first' },
      { type: 'system', session_id: 'second' }
    ]
    const mockSdk = makeMockSdk(messages)
    const handle = spawnViaSdk(
      mockSdk,
      { prompt: 'test', cwd: '/tmp', model: 'claude-sonnet' },
      MOCK_ENV,
      NO_TOKEN,
      SDK_STRATEGY
    )
    await collectMessages(handle.messages)
    expect(handle.sessionId).toBe('first')
  })
})

// ---------------------------------------------------------------------------
// abort() wiring
// ---------------------------------------------------------------------------

describe('spawnViaSdk abort()', () => {
  it('sets AbortController.signal.aborted after abort() is called', async () => {
    // Spy on AbortController.prototype.abort without replacing the
    // implementation — vi.spyOn alone lets the real native method run, so
    // signal.aborted is updated by the browser/Node built-in.
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

    const messages: SDKWireMessage[] = [{ type: 'exit_code', exit_code: 0 }]
    const mockSdk = makeMockSdk(messages)
    const handle = spawnViaSdk(
      mockSdk,
      { prompt: 'test', cwd: '/tmp', model: 'claude-sonnet' },
      MOCK_ENV,
      NO_TOKEN,
      SDK_STRATEGY
    )
    await collectMessages(handle.messages)

    expect(abortSpy).not.toHaveBeenCalled()
    handle.abort()
    expect(abortSpy).toHaveBeenCalledOnce()

    abortSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// steer()
// ---------------------------------------------------------------------------

describe('spawnViaSdk steer()', () => {
  it('returns { delivered: false, error: "SDK mode does not support steering" }', async () => {
    const mockSdk = makeMockSdk([])
    const handle = spawnViaSdk(
      mockSdk,
      { prompt: 'test', cwd: '/tmp', model: 'claude-sonnet' },
      MOCK_ENV,
      NO_TOKEN,
      SDK_STRATEGY
    )
    const result = await handle.steer('do something')
    expect(result).toEqual({ delivered: false, error: 'SDK mode does not support steering' })
  })
})

// ---------------------------------------------------------------------------
// rate-limit passthrough
// ---------------------------------------------------------------------------

describe('spawnViaSdk rate-limit message passthrough', () => {
  it('includes the rate-limit message in collected messages', async () => {
    const rateLimitMsg: SDKWireMessage = { type: 'system', subtype: 'rate_limit' }
    const messages: SDKWireMessage[] = [
      { type: 'system', session_id: 'sess-1' },
      rateLimitMsg,
      { type: 'exit_code', exit_code: 0 }
    ]
    const mockSdk = makeMockSdk(messages)
    const handle = spawnViaSdk(
      mockSdk,
      { prompt: 'test', cwd: '/tmp', model: 'claude-sonnet' },
      MOCK_ENV,
      NO_TOKEN,
      SDK_STRATEGY
    )
    const collected = await collectMessages(handle.messages)
    expect(collected).toContainEqual(rateLimitMsg)
  })
})

// ---------------------------------------------------------------------------
// Non-object message resilience
// ---------------------------------------------------------------------------

describe('spawnViaSdk non-object message resilience', () => {
  it('passes through a plain number without throwing', async () => {
    const messages = [42 as unknown as SDKWireMessage]
    const mockSdk = makeMockSdk(messages)
    const handle = spawnViaSdk(
      mockSdk,
      { prompt: 'test', cwd: '/tmp', model: 'claude-sonnet' },
      MOCK_ENV,
      NO_TOKEN,
      SDK_STRATEGY
    )
    const collected = await collectMessages(handle.messages)
    expect(collected).toContain(42)
  })
})
