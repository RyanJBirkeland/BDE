import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/local/bin' })),
  getOAuthToken: vi.fn(() => 'mock-oauth-token'),
  getClaudeCliPath: vi.fn(() => '/mock/path/to/claude')
}))

vi.mock('../../paths', () => ({
  getRepoPaths: vi.fn(() => ({ bde: '/Users/test/projects/BDE' }))
}))

let mockMessages: unknown[] = []
const mockQuery = vi.fn()

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args)
}))

import { spawnViaSdk } from '../spawn-sdk'
import * as sdk from '@anthropic-ai/claude-agent-sdk'

function setupMockQuery() {
  mockQuery.mockImplementation(() => {
    return {
      [Symbol.asyncIterator]() {
        const msgs = [...mockMessages]
        mockMessages = []
        let idx = 0
        return {
          next: async () => {
            if (idx < msgs.length) return { done: false, value: msgs[idx++] }
            return { done: true, value: undefined }
          }
        }
      }
    }
  })
}

const mockEnv = { PATH: '/usr/local/bin' }
const mockToken = 'mock-token'

describe('spawnViaSdk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMessages = []
    setupMockQuery()
  })

  it('returns an AgentHandle with expected shape', () => {
    const handle = spawnViaSdk(
      sdk,
      { prompt: 'test', cwd: '/tmp', model: 'sonnet' },
      mockEnv,
      mockToken
    )
    expect(handle).toHaveProperty('messages')
    expect(handle).toHaveProperty('sessionId')
    expect(typeof handle.sessionId).toBe('string')
    expect(typeof handle.abort).toBe('function')
    expect(typeof handle.steer).toBe('function')
  })

  it('starts with a fallback UUID session ID', () => {
    const handle = spawnViaSdk(
      sdk,
      { prompt: 'test', cwd: '/tmp', model: 'sonnet' },
      mockEnv,
      mockToken
    )
    expect(handle.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('updates sessionId from message stream', async () => {
    mockMessages = [{ type: 'system', session_id: 'extracted-session-id' }]

    const handle = spawnViaSdk(
      sdk,
      { prompt: 'test', cwd: '/tmp', model: 'sonnet' },
      mockEnv,
      mockToken
    )
    const initialId = handle.sessionId

    for await (const _msg of handle.messages) {
      /* consume */
    }

    expect(handle.sessionId).toBe('extracted-session-id')
    expect(handle.sessionId).not.toBe(initialId)
  })

  it('keeps fallback UUID when no session_id in messages', async () => {
    mockMessages = [{ type: 'assistant', text: 'hello' }]

    const handle = spawnViaSdk(
      sdk,
      { prompt: 'test', cwd: '/tmp', model: 'sonnet' },
      mockEnv,
      mockToken
    )
    for await (const _msg of handle.messages) {
      /* consume */
    }

    expect(handle.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('passes maxTurns: 20 to SDK', () => {
    spawnViaSdk(sdk, { prompt: 'test', cwd: '/tmp', model: 'sonnet' }, mockEnv, mockToken)
    const callArgs = mockQuery.mock.calls[0]?.[0]
    expect(callArgs?.options?.maxTurns).toBe(20)
  })

  it('uses settingSources [user, local]', () => {
    spawnViaSdk(sdk, { prompt: 'test', cwd: '/tmp', model: 'sonnet' }, mockEnv, mockToken)
    const callArgs = mockQuery.mock.calls[0]?.[0]
    expect(callArgs?.options?.settingSources).toEqual(['user', 'local'])
  })

  it('passes token via apiKey when token is provided', () => {
    spawnViaSdk(sdk, { prompt: 'test', cwd: '/tmp', model: 'sonnet' }, mockEnv, 'my-token')
    const callArgs = mockQuery.mock.calls[0]?.[0]
    expect(callArgs?.options?.apiKey).toBe('my-token')
  })

  it('omits apiKey when token is null', () => {
    spawnViaSdk(sdk, { prompt: 'test', cwd: '/tmp', model: 'sonnet' }, mockEnv, null)
    const callArgs = mockQuery.mock.calls[0]?.[0]
    expect(callArgs?.options).not.toHaveProperty('apiKey')
  })

  it('uses caller-supplied maxBudgetUsd', () => {
    spawnViaSdk(
      sdk,
      { prompt: 'test', cwd: '/tmp', model: 'sonnet', maxBudgetUsd: 5.0 },
      mockEnv,
      mockToken
    )
    const callArgs = mockQuery.mock.calls[0]?.[0]
    expect(callArgs?.options?.maxBudgetUsd).toBe(5.0)
  })

  it('defaults maxBudgetUsd to 2.0', () => {
    spawnViaSdk(sdk, { prompt: 'test', cwd: '/tmp', model: 'sonnet' }, mockEnv, mockToken)
    const callArgs = mockQuery.mock.calls[0]?.[0]
    expect(callArgs?.options?.maxBudgetUsd).toBe(2.0)
  })

  it('steer() returns delivered: false in SDK mode', async () => {
    const handle = spawnViaSdk(
      sdk,
      { prompt: 'test', cwd: '/tmp', model: 'sonnet' },
      mockEnv,
      mockToken
    )
    const result = await handle.steer('do something')
    expect(result).toEqual({ delivered: false, error: 'SDK mode does not support steering' })
  })

  it('steer() logs warning when logger provided', async () => {
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const handle = spawnViaSdk(
      sdk,
      { prompt: 'test', cwd: '/tmp', model: 'sonnet' },
      mockEnv,
      mockToken,
      logger
    )
    await handle.steer('steer message')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Steer not supported in SDK mode')
    )
  })
})

describe('spawnViaSdk wires worktree-isolation hook for pipeline agents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMessages = []
    setupMockQuery()
  })

  it('attaches a canUseTool that denies main-checkout writes when pipelineTuning is set', async () => {
    spawnViaSdk(
      sdk,
      {
        prompt: 'test',
        cwd: '/Users/test/worktrees/bde/abc',
        model: 'sonnet',
        pipelineTuning: { maxTurns: 20 }
      },
      mockEnv,
      mockToken
    )
    const callArgs = mockQuery.mock.calls[0]?.[0]
    const canUseTool = callArgs?.options?.canUseTool as
      | ((
          toolName: string,
          input: Record<string, unknown>,
          ctx: { signal: AbortSignal }
        ) => Promise<{
          behavior: 'deny' | 'allow'
          message?: string
        }>)
      | undefined
    expect(typeof canUseTool).toBe('function')

    const result = await canUseTool!(
      'Write',
      { file_path: '/Users/test/projects/BDE/src/main/foo.ts', content: 'y' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('deny')
  })

  it('leaves canUseTool permissive when pipelineTuning is not set (non-pipeline agents)', async () => {
    spawnViaSdk(sdk, { prompt: 'test', cwd: '/tmp', model: 'sonnet' }, mockEnv, mockToken)
    const callArgs = mockQuery.mock.calls[0]?.[0]
    const canUseTool = callArgs?.options?.canUseTool as
      | ((
          toolName: string,
          input: Record<string, unknown>,
          ctx: { signal: AbortSignal }
        ) => Promise<{
          behavior: 'deny' | 'allow'
        }>)
      | undefined
    expect(typeof canUseTool).toBe('function')

    const result = await canUseTool!(
      'Write',
      { file_path: '/Users/test/projects/BDE/src/main/foo.ts', content: 'y' },
      { signal: new AbortController().signal }
    )
    expect(result.behavior).toBe('allow')
  })
})
