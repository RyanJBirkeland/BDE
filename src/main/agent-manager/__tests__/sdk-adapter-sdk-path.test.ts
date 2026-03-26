import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------- mocks ----------

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/local/bin' })),
  getOAuthToken: vi.fn(() => 'mock-oauth-token')
}))

// We also need child_process mocked so the CLI fallback (if it were hit) wouldn't crash.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn()
}))

// The SDK mock: query() returns an async iterable with an interrupt() method.
let mockMessages: unknown[] = []
const mockInterrupt = vi.fn().mockResolvedValue(undefined)
const mockQuery = vi.fn()

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args)
}))

import { spawnAgent } from '../sdk-adapter'
import { getOAuthToken } from '../../env-utils'

// ---------- helpers ----------

function setupMockQuery() {
  mockQuery.mockImplementation(() => {
    let consumed = false
    return {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            if (!consumed && mockMessages.length > 0) {
              const msg = mockMessages.shift()
              if (msg === undefined) {
                consumed = true
                return { done: true, value: undefined }
              }
              return { done: false, value: msg }
            }
            consumed = true
            return { done: true, value: undefined }
          }
        }
      },
      interrupt: mockInterrupt
    }
  })
}

// ---------- tests ----------

describe('spawnAgent (SDK path)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMessages = []
    setupMockQuery()
  })

  it('returns an AgentHandle with messages, sessionId, abort, steer', async () => {
    const handle = await spawnAgent({
      prompt: 'Hello',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    expect(handle).toHaveProperty('messages')
    expect(handle).toHaveProperty('sessionId')
    expect(typeof handle.sessionId).toBe('string')
    expect(typeof handle.abort).toBe('function')
    expect(typeof handle.steer).toBe('function')
  })

  it('extracts session_id from messages via wrapMessages()', async () => {
    mockMessages = [
      { type: 'system', session_id: 'real-session-id' },
      { type: 'assistant', text: 'hello' }
    ]

    const handle = await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    // Before consuming, sessionId is a fallback UUID
    const initialId = handle.sessionId
    expect(initialId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

    // Consume messages
    const collected: unknown[] = []
    for await (const msg of handle.messages) {
      collected.push(msg)
    }

    expect(collected).toHaveLength(2)
    expect(handle.sessionId).toBe('real-session-id')
  })

  it('uses fallback UUID when no message contains session_id', async () => {
    mockMessages = [{ type: 'assistant', text: 'no session id here' }]

    const handle = await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    // Consume all messages
    for await (const _msg of handle.messages) {
      /* drain */
    }

    // sessionId should still be the fallback UUID
    expect(handle.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('steer() calls interrupt and logs a warning about limited steer', async () => {
    const mockWarn = vi.fn()
    const logger = { info: vi.fn(), warn: mockWarn, error: vi.fn() }

    const handle = await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5',
      logger
    })

    await handle.steer('please do something else')

    expect(mockInterrupt).toHaveBeenCalledOnce()
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('Steer in SDK mode is limited'))
  })

  it('does not set ANTHROPIC_API_KEY when getOAuthToken returns null', async () => {
    vi.mocked(getOAuthToken).mockReturnValueOnce(null as unknown as string)

    await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    // Verify SDK query was called with env that does NOT contain ANTHROPIC_API_KEY
    const callArgs = mockQuery.mock.calls[0][0]
    expect(callArgs.options.env).not.toHaveProperty('ANTHROPIC_API_KEY')
  })

  it('sets ANTHROPIC_API_KEY when getOAuthToken returns a token', async () => {
    // Default mock returns 'mock-oauth-token'
    await spawnAgent({
      prompt: 'test',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5'
    })

    const callArgs = mockQuery.mock.calls[0][0]
    expect(callArgs.options.env.ANTHROPIC_API_KEY).toBe('mock-oauth-token')
  })
})
