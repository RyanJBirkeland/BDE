import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_CONFIG } from '../types'
import { withMaxOldSpaceOption, AGENT_PROCESS_MAX_OLD_SPACE_MB } from '../sdk-adapter'

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn(() => ({ PATH: '/usr/local/bin' })),
  getOAuthToken: vi.fn(() => 'mock-oauth-token'),
  getClaudeCliPath: vi.fn(() => '/mock/path/to/claude')
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'exit_code', exit_code: 0 }
    }
  })
}))

import * as sdk from '@anthropic-ai/claude-agent-sdk'
import { spawnAgent } from '../sdk-adapter'

describe('pipeline agent SDK options', () => {
  beforeEach(() => {
    vi.mocked(sdk.query).mockClear()
  })

  it('passes maxTurns: 20 to SDK query', async () => {
    await spawnAgent({ prompt: 'test', cwd: '/tmp', model: DEFAULT_CONFIG.defaultModel })
    const callArgs = vi.mocked(sdk.query).mock.calls[0]?.[0]
    expect(callArgs?.options?.maxTurns).toBe(20)
  })

  it('uses settingSources [user, local] — not project', async () => {
    await spawnAgent({ prompt: 'test', cwd: '/tmp', model: DEFAULT_CONFIG.defaultModel })
    const callArgs = vi.mocked(sdk.query).mock.calls[0]?.[0]
    expect(callArgs?.options?.settingSources).toEqual(['user', 'local'])
    expect(callArgs?.options?.settingSources).not.toContain('project')
  })

  it('passes maxBudgetUsd to SDK query', async () => {
    await spawnAgent({ prompt: 'test', cwd: '/tmp', model: DEFAULT_CONFIG.defaultModel })
    const callArgs = vi.mocked(sdk.query).mock.calls[0]?.[0]
    expect(typeof callArgs?.options?.maxBudgetUsd).toBe('number')
    expect(callArgs?.options?.maxBudgetUsd).toBeGreaterThan(0)
  })

  it('uses caller-supplied maxBudgetUsd over default', async () => {
    await spawnAgent({ prompt: 'test', cwd: '/tmp', model: DEFAULT_CONFIG.defaultModel, maxBudgetUsd: 5.0 })
    const callArgs = vi.mocked(sdk.query).mock.calls[0]?.[0]
    expect(callArgs?.options?.maxBudgetUsd).toBe(5.0)
  })
})

describe('sdk-adapter', () => {
  describe('withMaxOldSpaceOption', () => {
    it('should add flag if NODE_OPTIONS is empty', () => {
      const result = withMaxOldSpaceOption(undefined, 1024)
      expect(result).toBe('--max-old-space-size=1024')
    })

    it('should add flag if NODE_OPTIONS is whitespace', () => {
      const result = withMaxOldSpaceOption('  ', 1024)
      expect(result).toBe('--max-old-space-size=1024')
    })

    it('should append to existing NODE_OPTIONS', () => {
      const result = withMaxOldSpaceOption('--expose-gc', 1024)
      expect(result).toBe('--expose-gc --max-old-space-size=1024')
    })

    it('should not add duplicate flag if already present', () => {
      const result = withMaxOldSpaceOption('--max-old-space-size=2048', 1024)
      expect(result).toBe('--max-old-space-size=2048')
    })

    it('should honor existing max-old-space-size even if different', () => {
      const result = withMaxOldSpaceOption('--expose-gc --max-old-space-size=512', 1024)
      expect(result).toBe('--expose-gc --max-old-space-size=512')
    })

    it('should use default AGENT_PROCESS_MAX_OLD_SPACE_MB constant', () => {
      const result = withMaxOldSpaceOption(undefined, AGENT_PROCESS_MAX_OLD_SPACE_MB)
      expect(result).toBe(`--max-old-space-size=${AGENT_PROCESS_MAX_OLD_SPACE_MB}`)
    })

    it('should handle complex NODE_OPTIONS with multiple flags', () => {
      const existing = '--expose-gc --trace-warnings --max-http-header-size=16384'
      const result = withMaxOldSpaceOption(existing, 2048)
      expect(result).toBe(
        '--expose-gc --trace-warnings --max-http-header-size=16384 --max-old-space-size=2048'
      )
    })

    it('should preserve exact existing value when flag already present', () => {
      const existing = '--trace-gc --max-old-space-size=8192'
      const result = withMaxOldSpaceOption(existing, 1024)
      expect(result).toBe(existing)
    })
  })
})
