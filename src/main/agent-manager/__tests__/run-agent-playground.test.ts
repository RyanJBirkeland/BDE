/**
 * Tests for Dev Playground prompt injection in run-agent.ts.
 * Validates that playground_enabled augments the agent prompt correctly,
 * and that helper functions work as expected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isRateLimitMessage, getNumericField, runAgent } from '../run-agent'
import type { RunAgentTask, RunAgentDeps } from '../run-agent'
import type { ActiveAgent } from '../types'

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

vi.mock('../fast-fail', () => ({
  classifyExit: vi.fn().mockReturnValue('normal-exit'),
}))

vi.mock('../worktree', () => ({
  cleanupWorktree: vi.fn(),
}))

vi.mock('../sdk-adapter', () => ({
  spawnAgent: vi.fn(),
}))

vi.mock('../completion', () => ({
  resolveSuccess: vi.fn().mockResolvedValue(undefined),
  resolveFailure: vi.fn().mockResolvedValue(false),
}))

vi.mock('../../data/sprint-queries', () => ({
  updateTask: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../paths', () => ({
  getGhRepo: vi.fn().mockReturnValue('owner/repo'),
}))

vi.mock('../../agent-history', () => ({
  createAgentRecord: vi.fn().mockResolvedValue(undefined),
  updateAgentMeta: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe('isRateLimitMessage', () => {
  it('returns true for rate limit messages', () => {
    expect(isRateLimitMessage({ type: 'system', subtype: 'rate_limit' })).toBe(true)
  })

  it('returns false for non-rate-limit messages', () => {
    expect(isRateLimitMessage({ type: 'system', subtype: 'other' })).toBe(false)
    expect(isRateLimitMessage({ type: 'text' })).toBe(false)
    expect(isRateLimitMessage(null)).toBe(false)
    expect(isRateLimitMessage('string')).toBe(false)
    expect(isRateLimitMessage(42)).toBe(false)
  })
})

describe('getNumericField', () => {
  it('returns numeric value when present', () => {
    expect(getNumericField({ cost_usd: 0.05 }, 'cost_usd')).toBe(0.05)
    expect(getNumericField({ exit_code: 0 }, 'exit_code')).toBe(0)
  })

  it('returns undefined for non-numeric or missing fields', () => {
    expect(getNumericField({ cost_usd: 'string' }, 'cost_usd')).toBeUndefined()
    expect(getNumericField({}, 'cost_usd')).toBeUndefined()
    expect(getNumericField(null, 'cost_usd')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Prompt injection integration tests
// ---------------------------------------------------------------------------

describe('runAgent — playground prompt injection', () => {
  let spawnAgentMock: ReturnType<typeof vi.fn>
  let capturedPrompt: string | undefined

  const createDeps = (): RunAgentDeps => ({
    activeAgents: new Map<string, ActiveAgent>(),
    defaultModel: 'claude-sonnet-4-20250514',
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    capturedPrompt = undefined

    // Dynamically import the mocked module to capture the prompt
    const sdkAdapter = await import('../sdk-adapter')
    spawnAgentMock = sdkAdapter.spawnAgent as ReturnType<typeof vi.fn>
  })

  function setupSpawnMock(): void {
    // Create an async iterable that yields one message then completes
    const messages = {
      async *[Symbol.asyncIterator]() {
        yield { exit_code: 0, cost_usd: 0.01, tokens_in: 100, tokens_out: 50 }
      },
    }
    spawnAgentMock.mockImplementation(async (opts: { prompt: string }) => {
      capturedPrompt = opts.prompt
      return { messages, result: Promise.resolve({ exitCode: 0 }) }
    })
  }

  it('appends playground instructions when playground_enabled is true', async () => {
    setupSpawnMock()
    const task: RunAgentTask = {
      id: 'task-pg-1',
      title: 'Build a button component',
      prompt: 'Create a styled button',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: true,
    }

    await runAgent(task, { worktreePath: '/tmp/wt', branch: 'agent/test' }, '/repo', createDeps())

    expect(capturedPrompt).toBeDefined()
    expect(capturedPrompt).toContain('Create a styled button')
    expect(capturedPrompt).toContain('## Dev Playground')
    expect(capturedPrompt).toContain('self-contained HTML file')
    expect(capturedPrompt).toContain('BDE renders the HTML natively')
  })

  it('does not append playground instructions when playground_enabled is false', async () => {
    setupSpawnMock()
    const task: RunAgentTask = {
      id: 'task-pg-2',
      title: 'Fix backend bug',
      prompt: 'Fix the database query',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: false,
    }

    await runAgent(task, { worktreePath: '/tmp/wt', branch: 'agent/test' }, '/repo', createDeps())

    expect(capturedPrompt).toBeDefined()
    expect(capturedPrompt).toBe('Fix the database query')
    expect(capturedPrompt).not.toContain('## Dev Playground')
  })

  it('does not append playground instructions when playground_enabled is undefined', async () => {
    setupSpawnMock()
    const task: RunAgentTask = {
      id: 'task-pg-3',
      title: 'Refactor module',
      prompt: 'Refactor the module',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      // playground_enabled not set
    }

    await runAgent(task, { worktreePath: '/tmp/wt', branch: 'agent/test' }, '/repo', createDeps())

    expect(capturedPrompt).toBeDefined()
    expect(capturedPrompt).toBe('Refactor the module')
    expect(capturedPrompt).not.toContain('## Dev Playground')
  })

  it('uses spec as prompt when prompt is null and playground_enabled', async () => {
    setupSpawnMock()
    const task: RunAgentTask = {
      id: 'task-pg-4',
      title: 'Component work',
      prompt: null,
      spec: 'Build a card component with hover effects',
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: true,
    }

    await runAgent(task, { worktreePath: '/tmp/wt', branch: 'agent/test' }, '/repo', createDeps())

    expect(capturedPrompt).toBeDefined()
    expect(capturedPrompt).toContain('Build a card component with hover effects')
    expect(capturedPrompt).toContain('## Dev Playground')
  })

  it('uses title as prompt when both prompt and spec are null', async () => {
    setupSpawnMock()
    const task: RunAgentTask = {
      id: 'task-pg-5',
      title: 'Create landing page',
      prompt: null,
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: true,
    }

    await runAgent(task, { worktreePath: '/tmp/wt', branch: 'agent/test' }, '/repo', createDeps())

    expect(capturedPrompt).toBeDefined()
    expect(capturedPrompt).toContain('Create landing page')
    expect(capturedPrompt).toContain('## Dev Playground')
  })

  it('marks task as error when prompt/spec/title are all empty', async () => {
    setupSpawnMock()
    const { updateTask } = await import('../../data/sprint-queries')
    const deps = createDeps()
    const task: RunAgentTask = {
      id: 'task-pg-6',
      title: '',
      prompt: '',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: true,
    }

    await runAgent(task, { worktreePath: '/tmp/wt', branch: 'agent/test' }, '/repo', deps)

    expect(updateTask).toHaveBeenCalledWith('task-pg-6', expect.objectContaining({
      status: 'error',
      notes: 'Empty prompt',
    }))
    // spawnAgent should NOT have been called
    expect(spawnAgentMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// RunAgentTask interface shape
// ---------------------------------------------------------------------------

describe('RunAgentTask interface', () => {
  it('allows playground_enabled as optional boolean', () => {
    const taskWithPlayground: RunAgentTask = {
      id: '1',
      title: 'test',
      prompt: 'test',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: true,
    }
    expect(taskWithPlayground.playground_enabled).toBe(true)

    const taskWithoutPlayground: RunAgentTask = {
      id: '2',
      title: 'test',
      prompt: 'test',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
    }
    expect(taskWithoutPlayground.playground_enabled).toBeUndefined()
  })
})
