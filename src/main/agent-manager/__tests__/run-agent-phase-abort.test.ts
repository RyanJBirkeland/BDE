/**
 * Tests for Phase 1 and Phase 2 unexpected-abort recovery in runAgent,
 * and for the fail-safe preserve logic in cleanupOrPreserveWorktree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PipelineAbortError } from '../pipeline-abort-error'

// ---------------------------------------------------------------------------
// Module mocks — must appear before any imports that pull these modules
// ---------------------------------------------------------------------------

vi.mock('../fast-fail', () => ({
  classifyExit: vi.fn().mockReturnValue('normal-exit')
}))

vi.mock('../worktree', () => ({
  cleanupWorktree: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../sdk-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sdk-adapter')>()
  const spawnAgent = vi.fn()
  return {
    ...actual,
    spawnAgent,
    spawnWithTimeout: vi.fn((_prompt: string, _cwd: string, _model: string) =>
      spawnAgent({ prompt: _prompt, cwd: _cwd, model: _model })
    )
  }
})

vi.mock('../../lib/prompt-composer', () => ({
  buildAgentPrompt: vi.fn((input) => input.taskContent + ':' + input.branch)
}))

vi.mock('../completion', () => ({
  resolveSuccess: vi.fn().mockResolvedValue(undefined),
  resolveFailure: vi.fn().mockReturnValue(false),
  deleteAgentBranchBeforeRetry: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../lib/main-repo-guards', () => ({
  assertRepoCleanOrAbort: vi.fn().mockResolvedValue(undefined),
  getMainRepoPorcelainStatus: vi.fn().mockResolvedValue('')
}))

vi.mock('../../lib/async-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/async-utils')>()
  return {
    ...actual,
    execFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
  }
})

vi.mock('../../data/sprint-queries', () => ({
  updateTask: vi.fn().mockReturnValue(undefined),
  forceUpdateTask: vi.fn().mockReturnValue(undefined)
}))

vi.mock('../../paths', () => ({
  getGhRepo: vi.fn().mockReturnValue('owner/repo'),
  BDE_TASK_MEMORY_DIR: '/home/user/.bde/memory/tasks'
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

vi.mock('../../broadcast', () => ({
  broadcast: vi.fn(),
  broadcastCoalesced: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  realpath: vi.fn().mockImplementation((p: string) => Promise.resolve(p))
}))

vi.mock('../../env-utils', () => ({
  invalidateOAuthToken: vi.fn(),
  refreshOAuthTokenFromKeychain: vi.fn().mockResolvedValue(false),
  buildAgentEnv: vi.fn().mockReturnValue({})
}))

vi.mock('../../services/credential-service', () => ({
  getDefaultCredentialService: vi.fn(() => ({
    getCredential: vi.fn().mockResolvedValue({ kind: 'claude', status: 'ok', token: 'test', expiresAt: null, cliFound: true }),
    refreshCredential: vi.fn().mockResolvedValue({ kind: 'claude', status: 'ok', token: 'test', expiresAt: null, cliFound: true }),
    invalidateCache: vi.fn()
  }))
}))

vi.mock('../../agent-event-mapper', () => ({
  mapRawMessage: vi.fn().mockReturnValue([]),
  emitAgentEvent: vi.fn(),
  flushAgentEventBatcher: vi.fn()
}))

vi.mock('../partial-diff-capture', () => ({
  capturePartialDiff: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../prompt-assembly', () => ({
  validateTaskForRun: vi.fn().mockResolvedValue(undefined),
  assembleRunContext: vi.fn().mockResolvedValue('mock prompt'),
  fetchUpstreamContext: vi.fn().mockReturnValue([]),
  readPriorScratchpad: vi.fn().mockReturnValue('')
}))

vi.mock('../spawn-and-wire', () => ({
  spawnAndWireAgent: vi.fn()
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { runAgent, cleanupOrPreserveWorktree } from '../run-agent'
import type { AgentRunClaim, RunAgentDeps } from '../run-agent'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { ActiveAgent } from '../types'
import { DEFAULT_CONFIG } from '../types'
import { validateTaskForRun, assembleRunContext } from '../prompt-assembly'
import { spawnAndWireAgent } from '../spawn-and-wire'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<AgentRunClaim> = {}): AgentRunClaim {
  return {
    id: 'task-1',
    title: 'Test task',
    prompt: 'Do something',
    spec: null,
    repo: 'bde',
    retry_count: 0,
    fast_fail_count: 0,
    ...overrides
  }
}

const mockRepo: IAgentTaskRepository = {
  getTask: vi.fn(),
  updateTask: vi.fn().mockReturnValue(null),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn().mockReturnValue([]),
  getOrphanedTasks: vi.fn(),
  clearStaleClaimedBy: vi.fn().mockReturnValue(0),
  getActiveTaskCount: vi.fn().mockReturnValue(0),
  claimTask: vi.fn(),
  getGroup: vi.fn().mockReturnValue(null),
  getGroupTasks: vi.fn().mockReturnValue([]),
  getGroupsWithDependencies: vi.fn().mockReturnValue([])
}

// Default happy-path spawnAndWireAgent return value (active agent handle with empty message stream)
const MOCK_AGENT_HANDLE = {
  messages: { async *[Symbol.asyncIterator]() { yield { exit_code: 0 } } },
  result: Promise.resolve({ exitCode: 0 })
}

const MOCK_AGENT: ActiveAgent = {
  taskId: 'task-1',
  agentRunId: 'run-1',
  handle: MOCK_AGENT_HANDLE as unknown as import('../types').AgentHandle,
  model: 'sonnet',
  startedAt: Date.now(),
  lastOutputAt: Date.now(),
  rateLimitCount: 0,
  costUsd: 0,
  tokensIn: 0,
  tokensOut: 0,
  maxRuntimeMs: null,
  maxCostUsd: null,
  worktreePath: '/tmp/wt',
  branch: 'agent/test'
}

const MOCK_TURN_TRACKER = {
  processMessage: vi.fn(),
  totals: vi.fn().mockReturnValue({ turns: 0, toolCalls: 0, rateLimit: 0 })
} as unknown as import('../turn-tracker').TurnTracker

const TERMINAL_STATUS_SET = new Set(['done', 'cancelled', 'failed', 'error'])

function makeDeps(overrides: Partial<RunAgentDeps> = {}): RunAgentDeps {
  const onTaskTerminal = vi.fn().mockResolvedValue(undefined)
  const taskStateService = {
    transition: vi.fn(async (taskId: string, status: string, ctx?: { fields?: Record<string, unknown> }) => {
      ;(mockRepo.updateTask as ReturnType<typeof vi.fn>)(taskId, { status, ...(ctx?.fields ?? {}) })
      if (TERMINAL_STATUS_SET.has(status)) {
        await onTaskTerminal(taskId, status)
      }
    })
  } as unknown as import('../../../services/task-state-service').TaskStateService

  return {
    activeAgents: new Map<string, ActiveAgent>(),
    defaultModel: DEFAULT_CONFIG.defaultModel,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      event: vi.fn()
    },
    onTaskTerminal,
    repo: mockRepo,
    unitOfWork: { runInTransaction: (fn) => fn() },
    metrics: {
      increment: vi.fn(),
      recordWatchdogVerdict: vi.fn(),
      setLastDrainDuration: vi.fn(),
      recordAgentDuration: vi.fn(),
      snapshot: vi.fn().mockReturnValue({}),
      reset: vi.fn()
    },
    taskStateService,
    ...overrides
  }
}

const worktree = { worktreePath: '/tmp/wt', branch: 'agent/test' }
const repoPath = '/repo'

// ---------------------------------------------------------------------------
// Phase 1 abort tests
// ---------------------------------------------------------------------------

describe('runAgent — Phase 1 unexpected error', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: both phase mocks succeed so tests can focus on individual faults
    vi.mocked(validateTaskForRun).mockResolvedValue(undefined)
    vi.mocked(assembleRunContext).mockResolvedValue('mock prompt')
    vi.mocked(spawnAndWireAgent).mockResolvedValue({
      agent: MOCK_AGENT,
      agentRunId: 'run-1',
      turnTracker: MOCK_TURN_TRACKER
    })
  })

  it('transitions task to error and releases claim on unexpected Phase 1 throw', async () => {
    vi.mocked(assembleRunContext).mockRejectedValue(new Error('fs failure'))

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'error', claimed_by: null })
    )
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'error')
  })

  it('logs the unexpected Phase 1 error with task ID and phase label', async () => {
    vi.mocked(assembleRunContext).mockRejectedValue(new Error('disk full'))

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/phase 1.*task-1|task-1.*phase 1/i)
    )
  })

  it('does not call onTaskTerminal when Phase 1 throws PipelineAbortError', async () => {
    vi.mocked(validateTaskForRun).mockRejectedValue(
      new PipelineAbortError('Task has no content')
    )

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    // onTaskTerminal must not be called by runAgent — the helper already handled it
    expect(deps.onTaskTerminal).not.toHaveBeenCalled()
  })

  it('still returns (no rethrow) when transition fails during Phase 1 abort recovery', async () => {
    vi.mocked(assembleRunContext).mockRejectedValue(new Error('unexpected'))
    const throwingStateService = {
      transition: vi.fn().mockRejectedValue(new Error('DB unavailable'))
    } as unknown as import('../../services/task-state-service').TaskStateService

    const deps = makeDeps({ taskStateService: throwingStateService })
    // Must not throw
    await expect(runAgent(makeTask(), worktree, repoPath, deps)).resolves.toBeUndefined()
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('failed to release claim'))
  })
})

// ---------------------------------------------------------------------------
// Phase 2 abort tests
// ---------------------------------------------------------------------------

describe('runAgent — Phase 2 unexpected error', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(validateTaskForRun).mockResolvedValue(undefined)
    vi.mocked(assembleRunContext).mockResolvedValue('mock prompt')
  })

  it('transitions task to error and releases claim on unexpected Phase 2 throw', async () => {
    vi.mocked(spawnAndWireAgent).mockRejectedValue(new Error('init tracking failed'))

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'error', claimed_by: null })
    )
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'error')
  })

  it('does not call onTaskTerminal when Phase 2 throws PipelineAbortError', async () => {
    vi.mocked(spawnAndWireAgent).mockRejectedValue(
      new PipelineAbortError('Spawn failed and recovered')
    )

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(deps.onTaskTerminal).not.toHaveBeenCalled()
  })

  it('still returns (no rethrow) when transition fails during Phase 2 abort recovery', async () => {
    vi.mocked(spawnAndWireAgent).mockRejectedValue(new Error('unexpected phase 2'))
    const throwingStateService = {
      transition: vi.fn().mockRejectedValue(new Error('DB down'))
    } as unknown as import('../../services/task-state-service').TaskStateService

    const deps = makeDeps({ taskStateService: throwingStateService })
    await expect(runAgent(makeTask(), worktree, repoPath, deps)).resolves.toBeUndefined()
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('failed to release claim'))
  })
})

// ---------------------------------------------------------------------------
// cleanupOrPreserveWorktree tests
// ---------------------------------------------------------------------------

describe('cleanupOrPreserveWorktree', () => {
  beforeEach(() => vi.clearAllMocks())

  it('preserves worktree and emits warn log when getTask throws', async () => {
    const repoMock: IAgentTaskRepository = {
      ...mockRepo,
      getTask: vi.fn().mockImplementation(() => { throw new Error('DB locked') }),
      updateTask: vi.fn()
    }
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }

    await cleanupOrPreserveWorktree(makeTask(), worktree, repoPath, repoMock, logger)

    // cleanupWorktreeWithRetry delegates to cleanupWorktree — assert it was NOT called
    const { cleanupWorktree } = await import('../worktree')
    expect(cleanupWorktree).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not read task status for task-1')
    )
  })

  it('preserves worktree and emits warn log when getTask returns null', async () => {
    const repoMock: IAgentTaskRepository = {
      ...mockRepo,
      getTask: vi.fn().mockReturnValue(null),
      updateTask: vi.fn()
    }
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }

    await cleanupOrPreserveWorktree(makeTask(), worktree, repoPath, repoMock, logger)

    const { cleanupWorktree } = await import('../worktree')
    expect(cleanupWorktree).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('task-1 not found in DB, preserving worktree')
    )
  })

  it('deletes worktree when task is in a non-review terminal status', async () => {
    const repoMock: IAgentTaskRepository = {
      ...mockRepo,
      getTask: vi.fn().mockReturnValue({ id: 'task-1', status: 'error' }),
      updateTask: vi.fn()
    }
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }

    await cleanupOrPreserveWorktree(makeTask(), worktree, repoPath, repoMock, logger)

    const { cleanupWorktree } = await import('../worktree')
    expect(cleanupWorktree).toHaveBeenCalled()
  })

  it('preserves worktree when task is in review status', async () => {
    const repoMock: IAgentTaskRepository = {
      ...mockRepo,
      getTask: vi.fn().mockReturnValue({ id: 'task-1', status: 'review' }),
      updateTask: vi.fn()
    }
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), event: vi.fn() }

    await cleanupOrPreserveWorktree(makeTask(), worktree, repoPath, repoMock, logger)

    const { cleanupWorktree } = await import('../worktree')
    expect(cleanupWorktree).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Preserving worktree for review task task-1')
    )
  })
})
