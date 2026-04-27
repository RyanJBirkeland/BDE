/**
 * Tests for Dev Playground prompt injection in run-agent.ts.
 * Validates that playground_enabled augments the agent prompt correctly,
 * and that helper functions work as expected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAgent } from '../run-agent'
import { isRateLimitMessage, getNumericField } from '../sdk-adapter'
import { tryEmitPlaygroundEvent } from '../playground-handler'
import { cleanupWorktree } from '../worktree'
import type { AgentRunClaim, RunAgentDeps } from '../run-agent'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { ActiveAgent } from '../types'

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

vi.mock('../fast-fail', () => ({
  classifyExit: vi.fn().mockReturnValue('normal-exit')
}))

vi.mock('../worktree', () => ({
  cleanupWorktree: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../playground-handler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../playground-handler')>()
  return {
    ...actual,
    tryEmitPlaygroundEvent: vi.fn().mockResolvedValue(undefined)
  }
})

vi.mock('../sdk-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sdk-adapter')>()
  const spawnAgent = vi.fn()
  return {
    ...actual,
    spawnAgent,
    spawnWithTimeout: vi.fn((_prompt: string, _cwd: string, _model: string, _logger: unknown) =>
      spawnAgent({ prompt: _prompt, cwd: _cwd, model: _model, logger: _logger })
    )
  }
})

vi.mock('../completion', () => ({
  resolveSuccess: vi.fn().mockResolvedValue(undefined),
  resolveFailure: vi.fn().mockResolvedValue(false)
}))

vi.mock('../../data/sprint-queries', () => ({
  updateTask: vi.fn().mockResolvedValue(undefined),
  forceUpdateTask: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../paths', () => ({
  getGhRepo: vi.fn().mockReturnValue('owner/repo'),
  BDE_TASK_MEMORY_DIR: '/tmp/bde-test/tasks'
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
  }
})

vi.mock('../../agent-history', () => ({
  createAgentRecord: vi.fn().mockResolvedValue(undefined),
  updateAgentMeta: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../agent-event-mapper', () => ({
  mapRawMessage: vi.fn().mockReturnValue([]),
  emitAgentEvent: vi.fn(),
  flushAgentEventBatcher: vi.fn()
}))

vi.mock('../../agent-system/memory/user-memory', () => ({
  getUserMemory: vi.fn(() => ({ content: '', totalBytes: 0, fileCount: 0 }))
}))

vi.mock('../../services/credential-service', () => ({
  getDefaultCredentialService: vi.fn(() => ({
    getCredential: vi.fn().mockResolvedValue({
      kind: 'claude',
      status: 'ok',
      token: 'test',
      expiresAt: null,
      cliFound: true
    }),
    refreshCredential: vi.fn().mockResolvedValue({
      kind: 'claude',
      status: 'ok',
      token: 'test',
      expiresAt: null,
      cliFound: true
    }),
    invalidateCache: vi.fn()
  }))
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

  const mockRepo: IAgentTaskRepository = {
    getTask: vi.fn(),
    updateTask: vi.fn().mockResolvedValue(null),
    getQueuedTasks: vi.fn(),
    getTasksWithDependencies: vi.fn().mockResolvedValue([]),
    getOrphanedTasks: vi.fn(),
    clearStaleClaimedBy: vi.fn().mockReturnValue(0),
    getActiveTaskCount: vi.fn().mockResolvedValue(0),
    claimTask: vi.fn(),
    getGroup: vi.fn().mockReturnValue(null),
    getGroupTasks: vi.fn().mockReturnValue([]),
    getGroupsWithDependencies: vi.fn().mockReturnValue([])
  }

  const createDeps = (): RunAgentDeps => ({
    activeAgents: new Map<string, ActiveAgent>(),
    defaultModel: 'claude-sonnet-4-20250514',
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      event: vi.fn()
    },
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    repo: mockRepo,
    unitOfWork: { runInTransaction: (fn) => fn() },
    metrics: {
      increment: vi.fn(),
      recordWatchdogVerdict: vi.fn(),
      setLastDrainDuration: vi.fn(),
      recordAgentDuration: vi.fn(),
      snapshot: vi.fn().mockReturnValue({}),
      reset: vi.fn()
    }
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
      }
    }
    spawnAgentMock.mockImplementation(async (opts: { prompt: string }) => {
      capturedPrompt = opts.prompt
      return { messages, result: Promise.resolve({ exitCode: 0 }) }
    })
  }

  it('appends playground instructions when playground_enabled is true', async () => {
    setupSpawnMock()
    const task: AgentRunClaim = {
      id: 'task-pg-1',
      title: 'Build a button component',
      prompt: 'Create a styled button',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: true
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
    const task: AgentRunClaim = {
      id: 'task-pg-2',
      title: 'Fix backend bug',
      prompt: 'Fix the database query',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: false
    }

    await runAgent(task, { worktreePath: '/tmp/wt', branch: 'agent/test' }, '/repo', createDeps())

    expect(capturedPrompt).toBeDefined()
    expect(capturedPrompt).toContain('Fix the database query')
    expect(capturedPrompt).not.toContain('## Dev Playground')
  })

  it('does not append playground instructions when playground_enabled is undefined', async () => {
    setupSpawnMock()
    const task: AgentRunClaim = {
      id: 'task-pg-3',
      title: 'Refactor module',
      prompt: 'Refactor the module',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0
      // playground_enabled not set
    }

    await runAgent(task, { worktreePath: '/tmp/wt', branch: 'agent/test' }, '/repo', createDeps())

    expect(capturedPrompt).toBeDefined()
    expect(capturedPrompt).toContain('Refactor the module')
    expect(capturedPrompt).not.toContain('## Dev Playground')
  })

  it('uses spec as prompt when prompt is null and playground_enabled', async () => {
    setupSpawnMock()
    const task: AgentRunClaim = {
      id: 'task-pg-4',
      title: 'Component work',
      prompt: null,
      spec: 'Build a card component with hover effects',
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: true
    }

    await runAgent(task, { worktreePath: '/tmp/wt', branch: 'agent/test' }, '/repo', createDeps())

    expect(capturedPrompt).toBeDefined()
    expect(capturedPrompt).toContain('Build a card component with hover effects')
    expect(capturedPrompt).toContain('## Dev Playground')
  })

  it('uses title as prompt when both prompt and spec are null', async () => {
    setupSpawnMock()
    const task: AgentRunClaim = {
      id: 'task-pg-5',
      title: 'Create landing page',
      prompt: null,
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: true
    }

    await runAgent(task, { worktreePath: '/tmp/wt', branch: 'agent/test' }, '/repo', createDeps())

    expect(capturedPrompt).toBeDefined()
    expect(capturedPrompt).toContain('Create landing page')
    expect(capturedPrompt).toContain('## Dev Playground')
  })

  it('marks task as error when prompt/spec/title are all empty', async () => {
    setupSpawnMock()
    const deps = createDeps()
    const task: AgentRunClaim = {
      id: 'task-pg-6',
      title: '',
      prompt: '',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: true
    }

    await runAgent(task, { worktreePath: '/tmp/wt', branch: 'agent/test' }, '/repo', deps)

    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-pg-6',
      expect.objectContaining({
        status: 'error',
        notes:
          'Agent failed to start: task has no prompt, spec, or title. To fix: edit the task and provide a prompt or spec describing what the agent should do.'
      })
    )
    // spawnAgent should NOT have been called
    expect(spawnAgentMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// AgentRunClaim interface shape
// ---------------------------------------------------------------------------

describe('AgentRunClaim interface', () => {
  it('allows playground_enabled as optional boolean', () => {
    const taskWithPlayground: AgentRunClaim = {
      id: '1',
      title: 'test',
      prompt: 'test',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: true
    }
    expect(taskWithPlayground.playground_enabled).toBe(true)

    const taskWithoutPlayground: AgentRunClaim = {
      id: '2',
      title: 'test',
      prompt: 'test',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0
    }
    expect(taskWithoutPlayground.playground_enabled).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Ordering guarantee: playground events must be emitted before worktree cleanup
// ---------------------------------------------------------------------------

describe('runAgent — playground-before-cleanup ordering', () => {
  const mockRepo: IAgentTaskRepository = {
    // Return a non-review task so cleanupOrPreserveWorktree proceeds to cleanup
    getTask: vi.fn().mockReturnValue({ id: 'task-order-1', status: 'done' }),
    updateTask: vi.fn().mockResolvedValue(null),
    getQueuedTasks: vi.fn(),
    getTasksWithDependencies: vi.fn().mockResolvedValue([]),
    getOrphanedTasks: vi.fn(),
    clearStaleClaimedBy: vi.fn().mockReturnValue(0),
    getActiveTaskCount: vi.fn().mockResolvedValue(0),
    claimTask: vi.fn(),
    getGroup: vi.fn().mockReturnValue(null),
    getGroupTasks: vi.fn().mockReturnValue([]),
    getGroupsWithDependencies: vi.fn().mockReturnValue([])
  }

  const createDeps = (): RunAgentDeps => ({
    activeAgents: new Map<string, ActiveAgent>(),
    defaultModel: 'claude-sonnet-4-20250514',
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      event: vi.fn()
    },
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    repo: mockRepo,
    unitOfWork: { runInTransaction: (fn) => fn() },
    metrics: {
      increment: vi.fn(),
      recordWatchdogVerdict: vi.fn(),
      setLastDrainDuration: vi.fn(),
      recordAgentDuration: vi.fn(),
      snapshot: vi.fn().mockReturnValue({}),
      reset: vi.fn()
    }
  })

  beforeEach(async () => {
    vi.clearAllMocks()

    const sdkAdapter = await import('../sdk-adapter')
    const spawnAgentMock = sdkAdapter.spawnAgent as ReturnType<typeof vi.fn>

    // Stream yields a tool_result for a Write to an .html file, then exits
    const messages = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'tool_result',
          tool_name: 'Write',
          input: { file_path: '/tmp/test.html' },
          exit_code: 0
        }
        yield { exit_code: 0, cost_usd: 0.01, tokens_in: 100, tokens_out: 50 }
      }
    }
    spawnAgentMock.mockImplementation(async () => ({
      messages,
      result: Promise.resolve({ exitCode: 0 })
    }))
  })

  it('awaits playground events before worktree cleanup', async () => {
    const callOrder: string[] = []

    vi.mocked(tryEmitPlaygroundEvent).mockImplementation(async () => {
      callOrder.push('emit')
    })
    vi.mocked(cleanupWorktree).mockImplementation(async () => {
      callOrder.push('cleanup')
      return undefined
    })

    const task: AgentRunClaim = {
      id: 'task-order-1',
      title: 'Ordering test',
      prompt: 'Build something visual',
      spec: null,
      repo: 'BDE',
      retry_count: 0,
      fast_fail_count: 0,
      playground_enabled: true
    }

    await runAgent(task, { worktreePath: '/tmp/wt', branch: 'agent/test' }, '/repo', createDeps())

    expect(callOrder).toContain('emit')
    expect(callOrder).toContain('cleanup')
    expect(callOrder.indexOf('emit')).toBeLessThan(callOrder.indexOf('cleanup'))
  })
})
