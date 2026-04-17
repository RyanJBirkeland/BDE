/**
 * Tests for run-agent.ts failure modes: spawn failures, auth errors,
 * watchdog race, fast-fail paths, and completion fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  runAgent,
  validateTaskForRun,
  assembleRunContext,
  fetchUpstreamContext,
  readPriorScratchpad,
  consumeMessages
} from '../run-agent'
import { detectHtmlWrite, detectPlaygroundWrite, tryEmitPlaygroundEvent } from '../playground-handler'
import type {
  AgentRunClaim,
  RunAgentDeps,
  RunAgentSpawnDeps,
  RunAgentDataDeps,
  RunAgentEventDeps
} from '../run-agent'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { ActiveAgent } from '../types'
import { mkdirSync, readFileSync } from 'node:fs'
import { buildAgentPrompt } from '../../lib/prompt-composer'
import { TurnTracker } from '../turn-tracker'
import { emitAgentEvent } from '../../agent-event-mapper'
const mockMkdirSync = vi.mocked(mkdirSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockBuildAgentPrompt = vi.mocked(buildAgentPrompt)

// ---------------------------------------------------------------------------
// Mocks
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
    spawnWithTimeout: vi.fn((_prompt: string, _cwd: string, _model: string, _logger: unknown) =>
      spawnAgent({ prompt: _prompt, cwd: _cwd, model: _model, logger: _logger })
    )
  }
})

vi.mock('../../lib/prompt-composer', () => ({
  buildAgentPrompt: vi.fn((input) => {
    // Simple mock that concatenates taskContent with branch info
    return input.taskContent + (input.branch ? `\n\nBranch: ${input.branch}` : '')
  })
}))

vi.mock('../completion', () => ({
  resolveSuccess: vi.fn().mockResolvedValue(undefined),
  resolveFailure: vi.fn().mockReturnValue(false)
}))

vi.mock('../../data/sprint-queries', () => ({
  updateTask: vi.fn().mockReturnValue(undefined)
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
  // realpath resolves symlinks; default mock returns the path unchanged (no symlinks in tests)
  realpath: vi.fn().mockImplementation((p: string) => Promise.resolve(p))
}))

vi.mock('../../env-utils', () => ({
  invalidateOAuthToken: vi.fn(),
  refreshOAuthTokenFromKeychain: vi.fn().mockResolvedValue(false)
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

vi.mock('../../agent-event-mapper', () => ({
  mapRawMessage: vi.fn().mockReturnValue([]),
  emitAgentEvent: vi.fn(),
  flushAgentEventBatcher: vi.fn()
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<AgentRunClaim> = {}): AgentRunClaim {
  return {
    id: 'task-1',
    title: 'Test task',
    prompt: 'Do something',
    spec: null,
    repo: 'BDE',
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

function makeDeps(overrides: Partial<RunAgentDeps> = {}): RunAgentDeps {
  return {
    activeAgents: new Map<string, ActiveAgent>(),
    defaultModel: 'claude-sonnet-4-5',
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    },
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    repo: mockRepo,
    ...overrides
  }
}

const worktree = { worktreePath: '/tmp/wt', branch: 'agent/test' }
const repoPath = '/repo'

/** Creates a mock AgentHandle whose message iterator yields given messages then completes */
function makeHandle(messages: unknown[] = [{ exit_code: 0 }]) {
  return {
    messages: {
      async *[Symbol.asyncIterator]() {
        for (const m of messages) yield m
      }
    },
    result: Promise.resolve({ exitCode: 0 })
  }
}

/** Creates a mock AgentHandle whose message iterator throws */
function makeErrorHandle(error: Error) {
  return {
    messages: {
      async *[Symbol.asyncIterator]() {
        throw error
      }
    },
    result: Promise.resolve({ exitCode: 1 })
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAgent — spawn failures', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks task as error when spawn times out', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { cleanupWorktree } = await import('../worktree')

    // spawnAgent never resolves
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}))

    // Override SPAWN_TIMEOUT_MS by making the race lose to a short timeout
    // We can't easily override the constant, so instead we make spawnAgent reject quickly
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Spawn timed out after 60s')
    )

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'error',
        notes: expect.stringContaining('Spawn failed:'),
        claimed_by: null
      })
    )
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'error')
    expect(cleanupWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath,
        worktreePath: worktree.worktreePath,
        branch: worktree.branch
      })
    )
  })

  it('marks task as error when spawn rejects with a specific error', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { cleanupWorktree } = await import('../worktree')

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ENOENT: claude binary not found')
    )

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'error',
        notes: expect.stringContaining('ENOENT: claude binary not found')
      })
    )
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'error')
    expect(cleanupWorktree).toHaveBeenCalled()
  })
})

describe('runAgent — auth error handling', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invalidates OAuth token on "Invalid API key" error', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { invalidateOAuthToken } = await import('../../env-utils')

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeErrorHandle(new Error('Invalid API key'))
    )

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(invalidateOAuthToken).toHaveBeenCalled()
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Auth failure detected'))
  })

  it('handles refreshOAuthTokenFromKeychain rejection gracefully', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { invalidateOAuthToken, refreshOAuthTokenFromKeychain } = await import('../../env-utils')
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeErrorHandle(new Error('invalid_api_key'))
    )
    ;(refreshOAuthTokenFromKeychain as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('keychain locked')
    )
    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)
    expect(invalidateOAuthToken).toHaveBeenCalled()
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Auth failure detected'))
  })

  it('logs success when refreshOAuthTokenFromKeychain succeeds', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { refreshOAuthTokenFromKeychain } = await import('../../env-utils')
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeErrorHandle(new Error('authentication failed'))
    )
    ;(refreshOAuthTokenFromKeychain as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)
    expect(refreshOAuthTokenFromKeychain).toHaveBeenCalled()
  })
})

describe('runAgent — watchdog race', () => {
  beforeEach(() => vi.clearAllMocks())

  it('logs "already cleaned up by watchdog" and does not call resolveSuccess', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { resolveSuccess } = await import('../completion')
    const { cleanupWorktree } = await import('../worktree')

    const activeAgents = new Map<string, ActiveAgent>()

    // After messages are consumed, activeAgents should NOT have task.id
    // We achieve this by deleting from activeAgents during message iteration
    const handle = {
      messages: {
        async *[Symbol.asyncIterator]() {
          yield { exit_code: 0 }
          // Simulate watchdog removing the agent between message loop end and the check
          activeAgents.delete('task-1')
        }
      },
      result: Promise.resolve({ exitCode: 0 })
    }

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(handle)

    const deps = makeDeps({ activeAgents })
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('already cleaned up or superseded by retry')
    )
    expect(resolveSuccess).not.toHaveBeenCalled()
    expect(cleanupWorktree).toHaveBeenCalled()
  })
})

describe('runAgent — fast-fail paths', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks task as error when classifyExit returns fast-fail-exhausted', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { classifyExit } = await import('../fast-fail')

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle([{ exit_code: 1 }]))
    ;(classifyExit as ReturnType<typeof vi.fn>).mockReturnValue('fast-fail-exhausted')

    const deps = makeDeps()
    await runAgent(makeTask({ fast_fail_count: 2 }), worktree, repoPath, deps)

    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'error',
        notes:
          "Agent failed 3 times within 30s of starting. Common causes: expired OAuth token (~/.bde/oauth-token), missing npm dependencies, or invalid task spec. Check ~/.bde/agent-manager.log for details. To retry: reset task status to 'queued' and clear claimed_by.",
        needs_review: true,
        claimed_by: null
      })
    )
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'error')
  })

  it('requeues task with incremented fast_fail_count when classifyExit returns fast-fail-requeue', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { classifyExit } = await import('../fast-fail')

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle([{ exit_code: 1 }]))
    ;(classifyExit as ReturnType<typeof vi.fn>).mockReturnValue('fast-fail-requeue')

    const deps = makeDeps()
    await runAgent(makeTask({ fast_fail_count: 1 }), worktree, repoPath, deps)

    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        status: 'queued',
        fast_fail_count: 2,
        claimed_by: null
      })
    )
    // onTaskTerminal should NOT be called for requeue
    expect(deps.onTaskTerminal).not.toHaveBeenCalledWith('task-1', 'error')
  })
})

describe('runAgent — completion fallback', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls resolveFailure when resolveSuccess throws, and calls onTaskTerminal if terminal', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { classifyExit } = await import('../fast-fail')
    const { resolveSuccess, resolveFailure } = await import('../completion')

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle([{ exit_code: 0 }]))
    ;(classifyExit as ReturnType<typeof vi.fn>).mockReturnValue('normal-exit')
    ;(resolveSuccess as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('PR creation failed'))
    ;(resolveFailure as ReturnType<typeof vi.fn>).mockReturnValue(true)

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(resolveFailure).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', retryCount: 0 }),
      deps.logger
    )
    expect(deps.onTaskTerminal).toHaveBeenCalledWith('task-1', 'failed')
  })

  it('does NOT call onTaskTerminal when resolveFailure returns false (retry queued)', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { classifyExit } = await import('../fast-fail')
    const { resolveSuccess, resolveFailure } = await import('../completion')

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle([{ exit_code: 0 }]))
    ;(classifyExit as ReturnType<typeof vi.fn>).mockReturnValue('normal-exit')
    ;(resolveSuccess as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('PR creation failed'))
    ;(resolveFailure as ReturnType<typeof vi.fn>).mockReturnValue(false)

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(resolveFailure).toHaveBeenCalled()
    expect(deps.onTaskTerminal).not.toHaveBeenCalled()
  })
})

describe('detectHtmlWrite', () => {
  it('returns file path for tool_result Write of .html file', () => {
    expect(
      detectHtmlWrite({
        type: 'tool_result',
        tool_name: 'Write',
        input: { file_path: '/tmp/wt/index.html' }
      })
    ).toBe('/tmp/wt/index.html')
  })
  it('returns file path for result type with name Write', () => {
    expect(
      detectHtmlWrite({ type: 'result', name: 'Write', input: { file_path: 'output.html' } })
    ).toBe('output.html')
  })
  it('returns null for non-html file', () => {
    expect(
      detectHtmlWrite({
        type: 'tool_result',
        tool_name: 'Write',
        input: { file_path: '/tmp/wt/file.ts' }
      })
    ).toBeNull()
  })
  it('returns null for non-Write tool', () => {
    expect(
      detectHtmlWrite({
        type: 'tool_result',
        tool_name: 'Read',
        input: { file_path: '/tmp/wt/index.html' }
      })
    ).toBeNull()
  })
  it('returns null for non-tool_result/result type', () => {
    expect(detectHtmlWrite({ type: 'assistant', text: 'hello' })).toBeNull()
  })
  it('returns null for null/non-object inputs', () => {
    expect(detectHtmlWrite(null)).toBeNull()
    expect(detectHtmlWrite('string')).toBeNull()
  })
  it('returns null when input has no file_path', () => {
    expect(detectHtmlWrite({ type: 'tool_result', tool_name: 'Write', input: {} })).toBeNull()
  })
  it('is case-insensitive for tool name', () => {
    expect(
      detectHtmlWrite({
        type: 'tool_result',
        tool_name: 'write',
        input: { file_path: 'page.HTML' }
      })
    ).toBe('page.HTML')
  })
})

describe('detectPlaygroundWrite', () => {
  it('detects .svg file writes with contentType svg', () => {
    const result = detectPlaygroundWrite({
      type: 'tool_result',
      tool_name: 'Write',
      input: { file_path: '/tmp/wt/diagram.svg' }
    })
    expect(result).toEqual({ path: '/tmp/wt/diagram.svg', contentType: 'svg' })
  })
  it('detects .md file writes with contentType markdown', () => {
    const result = detectPlaygroundWrite({
      type: 'tool_result',
      tool_name: 'Write',
      input: { file_path: '/tmp/wt/notes.md' }
    })
    expect(result).toEqual({ path: '/tmp/wt/notes.md', contentType: 'markdown' })
  })
  it('detects .markdown file writes with contentType markdown', () => {
    const result = detectPlaygroundWrite({
      type: 'tool_result',
      tool_name: 'Write',
      input: { file_path: '/tmp/wt/readme.markdown' }
    })
    expect(result).toEqual({ path: '/tmp/wt/readme.markdown', contentType: 'markdown' })
  })
  it('detects .json file writes with contentType json', () => {
    const result = detectPlaygroundWrite({
      type: 'tool_result',
      tool_name: 'Write',
      input: { file_path: '/tmp/wt/data.json' }
    })
    expect(result).toEqual({ path: '/tmp/wt/data.json', contentType: 'json' })
  })
  it('detects .html file writes with contentType html', () => {
    const result = detectPlaygroundWrite({
      type: 'tool_result',
      tool_name: 'Write',
      input: { file_path: '/tmp/wt/index.html' }
    })
    expect(result).toEqual({ path: '/tmp/wt/index.html', contentType: 'html' })
  })
  it('returns null for unsupported file types', () => {
    expect(
      detectPlaygroundWrite({
        type: 'tool_result',
        tool_name: 'Write',
        input: { file_path: '/tmp/wt/file.ts' }
      })
    ).toBeNull()
  })
  it('returns null for non-Write tools', () => {
    expect(
      detectPlaygroundWrite({
        type: 'tool_result',
        tool_name: 'Read',
        input: { file_path: '/tmp/wt/diagram.svg' }
      })
    ).toBeNull()
  })
  it('is case-insensitive for file extension', () => {
    const result = detectPlaygroundWrite({
      type: 'tool_result',
      tool_name: 'Write',
      input: { file_path: 'output.SVG' }
    })
    expect(result).toEqual({ path: 'output.SVG', contentType: 'svg' })
  })
})

describe('tryEmitPlaygroundEvent', () => {
  beforeEach(() => vi.clearAllMocks())
  it('emits playground event for a valid HTML file', async () => {
    const { stat } = await import('node:fs/promises')
    const { readFile } = await import('node:fs/promises')
    const { emitAgentEvent } = await import('../../agent-event-mapper')
    vi.mocked(stat).mockResolvedValue({ size: 1024 } as any)
    vi.mocked(readFile).mockResolvedValue('<html>hello</html>')
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    await tryEmitPlaygroundEvent('task-1', '/wt/index.html', '/wt', logger)
    expect(emitAgentEvent).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        type: 'agent:playground',
        filename: 'index.html',
        html: expect.any(String)
      })
    )
  })
  it('resolves relative path against worktreePath', async () => {
    const { stat } = await import('node:fs/promises')
    const { readFile } = await import('node:fs/promises')
    vi.mocked(stat).mockResolvedValue({ size: 100 } as any)
    vi.mocked(readFile).mockResolvedValue('<html/>')
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    await tryEmitPlaygroundEvent('task-1', 'relative/file.html', '/wt/path', logger)
    expect(stat).toHaveBeenCalledWith('/wt/path/relative/file.html')
  })
  it('skips file that is too large', async () => {
    const { stat } = await import('node:fs/promises')
    const { emitAgentEvent } = await import('../../agent-event-mapper')
    vi.mocked(stat).mockResolvedValue({ size: 10 * 1024 * 1024 } as any)
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    await tryEmitPlaygroundEvent('task-1', '/wt/big.html', '/wt', logger)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('File too large'))
    expect(emitAgentEvent).not.toHaveBeenCalled()
  })
  it('logs warning on file read error', async () => {
    const { stat } = await import('node:fs/promises')
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    await tryEmitPlaygroundEvent('task-1', '/wt/missing.html', '/wt', logger)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read playground file')
    )
  })
})

describe('runAgent — lastAgentOutput capture', () => {
  beforeEach(() => vi.clearAllMocks())
  it('captures last assistant text and passes to resolveSuccess as agentSummary', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { classifyExit } = await import('../fast-fail')
    const { resolveSuccess } = await import('../completion')
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeHandle([
        { type: 'assistant', text: 'First response' },
        { type: 'assistant', text: 'Final answer with details about the implementation' },
        { exit_code: 0 }
      ])
    )
    ;(classifyExit as ReturnType<typeof vi.fn>).mockReturnValue('normal-exit')
    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)
    expect(resolveSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSummary: expect.stringContaining('Final answer with details')
      }),
      deps.logger
    )
  })
})

describe('runAgent — updateTask.catch error handlers', () => {
  beforeEach(() => vi.clearAllMocks())
  it('logs error when updateTask rejects in fast-fail-exhausted path', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { classifyExit } = await import('../fast-fail')
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle([{ exit_code: 1 }]))
    ;(classifyExit as ReturnType<typeof vi.fn>).mockReturnValue('fast-fail-exhausted')
    ;(mockRepo.updateTask as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('DB error')
    })
    const deps = makeDeps()
    await runAgent(makeTask({ fast_fail_count: 3 }), worktree, repoPath, deps)
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update task task-1 after fast-fail exhausted')
    )
  })
  it('logs error when updateTask rejects in fast-fail-requeue path', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { classifyExit } = await import('../fast-fail')
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle([{ exit_code: 1 }]))
    ;(classifyExit as ReturnType<typeof vi.fn>).mockReturnValue('fast-fail-requeue')
    ;(mockRepo.updateTask as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('DB error')
    })
    const deps = makeDeps()
    await runAgent(makeTask({ fast_fail_count: 1 }), worktree, repoPath, deps)
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to requeue fast-fail task task-1')
    )
  })
  it('logs warning when updateTask rejects in spawn failure .catch path', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Spawn failed'))
    ;(mockRepo.updateTask as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('DB error')
    })
    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update task task-1 after spawn failure')
    )
  })
})

describe('runAgent — circuit breaker hook wiring', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invokes onSpawnSuccess (and not onSpawnFailure) when spawn resolves', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle([{ exit_code: 0 }]))

    const onSpawnSuccess = vi.fn()
    const onSpawnFailure = vi.fn()
    const deps = makeDeps({ onSpawnSuccess, onSpawnFailure })
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(onSpawnSuccess).toHaveBeenCalledTimes(1)
    expect(onSpawnFailure).not.toHaveBeenCalled()
  })

  it('invokes onSpawnFailure (and not onSpawnSuccess) when spawn rejects', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ENOENT: claude binary not found')
    )

    const onSpawnSuccess = vi.fn()
    const onSpawnFailure = vi.fn()
    const deps = makeDeps({ onSpawnSuccess, onSpawnFailure })
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(onSpawnFailure).toHaveBeenCalledTimes(1)
    expect(onSpawnSuccess).not.toHaveBeenCalled()
  })

  it('invokes onSpawnFailure on spawn timeout', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    // Simulate the timeout race winning by rejecting with the timeout message
    // (mirrors what the Promise.race timeout branch produces).
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Spawn timed out after 60s')
    )

    const onSpawnSuccess = vi.fn()
    const onSpawnFailure = vi.fn()
    const deps = makeDeps({ onSpawnSuccess, onSpawnFailure })
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(onSpawnFailure).toHaveBeenCalledTimes(1)
    expect(onSpawnSuccess).not.toHaveBeenCalled()
  })
})

describe('runAgent — prompt composer integration', () => {
  beforeEach(() => vi.clearAllMocks())
  it('calls buildAgentPrompt with pipeline agentType, taskContent, branch, and playground flag', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { buildAgentPrompt } = await import('../../lib/prompt-composer')
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle([{ exit_code: 0 }]))

    const deps = makeDeps()
    await runAgent(
      makeTask({ prompt: 'Fix the bug', playground_enabled: true }),
      worktree,
      repoPath,
      deps
    )

    expect(buildAgentPrompt).toHaveBeenCalledWith({
      agentType: 'pipeline',
      taskContent: 'Fix the bug',
      branch: 'agent/test',
      playgroundEnabled: true,
      retryCount: 0,
      previousNotes: undefined,
      maxRuntimeMs: undefined,
      upstreamContext: undefined,
      crossRepoContract: undefined,
      repoName: 'BDE',
      taskId: 'task-1',
      priorScratchpad: ''
    })
  })

  it('calls spawnAgent with the composed prompt', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { buildAgentPrompt } = await import('../../lib/prompt-composer')
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle([{ exit_code: 0 }]))
    ;(buildAgentPrompt as ReturnType<typeof vi.fn>).mockReturnValue('COMPOSED_PROMPT')

    const deps = makeDeps()
    await runAgent(makeTask({ prompt: 'Test task' }), worktree, repoPath, deps)

    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'COMPOSED_PROMPT'
      })
    )
  })

  it('uses task.model when provided, otherwise falls back to defaultModel', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle([{ exit_code: 0 }]))

    const deps = makeDeps()

    // Test 1: task with explicit model
    await runAgent(makeTask({ model: 'claude-haiku-3-5' }), worktree, repoPath, deps)
    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-3-5'
      })
    )

    // Test 2: task without model (should use defaultModel)
    ;(spawnAgent as ReturnType<typeof vi.fn>).mockClear()
    await runAgent(makeTask({ model: null }), worktree, repoPath, deps)
    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-5' // defaultModel from makeDeps
      })
    )
  })

  describe('task scratchpad wiring', () => {
    beforeEach(() => {
      mockMkdirSync.mockReset()
      mockReadFileSync.mockReset()
      mockBuildAgentPrompt.mockReset()
      mockBuildAgentPrompt.mockImplementation((input) => {
        return (input.taskContent ?? '') + (input.branch ? `\n\nBranch: ${input.branch}` : '')
      })
    })

    it('creates scratchpad directory with task id before buildAgentPrompt', async () => {
      mockReadFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      await runAgent(makeTask({ id: 'task-xyz' }), worktree, repoPath, makeDeps())

      expect(mockMkdirSync).toHaveBeenCalledWith('/home/user/.bde/memory/tasks/task-xyz', {
        recursive: true
      })
    })

    it('passes empty priorScratchpad to buildAgentPrompt when progress.md is absent', async () => {
      mockReadFileSync.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      await runAgent(makeTask({ id: 'task-xyz' }), worktree, repoPath, makeDeps())

      expect(mockBuildAgentPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-xyz', priorScratchpad: '' })
      )
    })

    it('passes progress.md content as priorScratchpad when file exists', async () => {
      mockReadFileSync.mockReturnValue('## Prior notes\nTried approach A, failed with error XYZ')

      await runAgent(makeTask({ id: 'task-xyz' }), worktree, repoPath, makeDeps())

      expect(mockBuildAgentPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-xyz',
          priorScratchpad: '## Prior notes\nTried approach A, failed with error XYZ'
        })
      )
    })
  })
})

// Compile-time: RunAgentDeps must satisfy each sub-interface
type _SpawnCheck = RunAgentDeps extends RunAgentSpawnDeps ? true : never
type _DataCheck = RunAgentDeps extends RunAgentDataDeps ? true : never
type _EventCheck = RunAgentDeps extends RunAgentEventDeps ? true : never

describe('validateTaskForRun', () => {
  it('throws and calls onTaskTerminal when task has no content', async () => {
    const mockRepoLocal = {
      updateTask: vi.fn().mockReturnValue(null),
      getTask: vi.fn().mockReturnValue(null)
    } as unknown as IAgentTaskRepository
    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

    const emptyTask: AgentRunClaim = {
      id: 'task-1',
      title: '',
      prompt: null,
      spec: null,
      repo: 'bde',
      retry_count: 0,
      fast_fail_count: 0
    }

    await expect(
      validateTaskForRun(emptyTask, { worktreePath: '/wt', branch: 'b' }, '/repo', {
        activeAgents: new Map(),
        defaultModel: 'claude-3-5-sonnet-20241022',
        logger,
        onTaskTerminal,
        repo: mockRepoLocal
      })
    ).rejects.toThrow('Task has no content')

    expect(onTaskTerminal).toHaveBeenCalledWith('task-1', 'error')
    expect(mockRepoLocal.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'error' })
    )
  })

  it('resolves without throwing when task has a title', async () => {
    const mockRepoLocal = {
      updateTask: vi.fn(),
      getTask: vi.fn().mockReturnValue(null)
    } as unknown as IAgentTaskRepository
    const task: AgentRunClaim = {
      id: 'task-1',
      title: 'Do the thing',
      prompt: null,
      spec: null,
      repo: 'bde',
      retry_count: 0,
      fast_fail_count: 0
    }

    await expect(
      validateTaskForRun(task, { worktreePath: '/wt', branch: 'b' }, '/repo', {
        activeAgents: new Map(),
        defaultModel: 'claude-3-5-sonnet-20241022',
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        onTaskTerminal: vi.fn(),
        repo: mockRepoLocal
      })
    ).resolves.toBeUndefined()

    expect(mockRepoLocal.updateTask).not.toHaveBeenCalled()
  })
})

describe('fetchUpstreamContext', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns [] when deps is null', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const result = fetchUpstreamContext(null, mockRepo, logger)
    expect(result).toEqual([])
  })

  it('returns [] when deps is undefined', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const result = fetchUpstreamContext(undefined, mockRepo, logger)
    expect(result).toEqual([])
  })

  it('returns [] when deps is an empty array', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const result = fetchUpstreamContext([], mockRepo, logger)
    expect(result).toEqual([])
  })

  it('returns context entries for done upstream tasks with non-empty spec', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    ;(mockRepo.getTask as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'upstream-1',
      title: 'Upstream task',
      status: 'done',
      spec: 'Do the upstream thing',
      prompt: null,
      partial_diff: 'diff content'
    })
    const result = fetchUpstreamContext([{ id: 'upstream-1', type: 'hard' }], mockRepo, logger)
    expect(result).toEqual([
      { title: 'Upstream task', spec: 'Do the upstream thing', partial_diff: 'diff content' }
    ])
  })

  it('skips upstream tasks that are not done', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    ;(mockRepo.getTask as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'upstream-1',
      title: 'Active task',
      status: 'active',
      spec: 'Some spec',
      prompt: null
    })
    const result = fetchUpstreamContext([{ id: 'upstream-1', type: 'hard' }], mockRepo, logger)
    expect(result).toEqual([])
  })

  it('skips upstream tasks with empty spec', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    ;(mockRepo.getTask as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'upstream-1',
      title: 'Done task',
      status: 'done',
      spec: '',
      prompt: ''
    })
    const result = fetchUpstreamContext([{ id: 'upstream-1', type: 'hard' }], mockRepo, logger)
    expect(result).toEqual([])
  })
})

describe('readPriorScratchpad', () => {
  beforeEach(() => {
    mockMkdirSync.mockReset()
    mockReadFileSync.mockReset()
  })

  it('returns empty string when no progress.md exists', () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    const result = readPriorScratchpad('task-abc')
    expect(result).toBe('')
    expect(mockMkdirSync).toHaveBeenCalledWith('/home/user/.bde/memory/tasks/task-abc', {
      recursive: true
    })
  })

  it('returns file contents when progress.md exists', () => {
    mockReadFileSync.mockReturnValue('## Prior notes\nSome progress was made')
    const result = readPriorScratchpad('task-abc')
    expect(result).toBe('## Prior notes\nSome progress was made')
  })
})

describe('assembleRunContext', () => {
  it('returns a non-empty prompt string', async () => {
    const mockRepoLocal = {
      getTask: vi.fn().mockReturnValue(null)
    } as unknown as IAgentTaskRepository
    const task: AgentRunClaim = {
      id: 'task-1',
      title: 'Test task',
      prompt: 'Do the thing.',
      spec: null,
      repo: 'bde',
      retry_count: 0,
      fast_fail_count: 0
    }

    const prompt = await assembleRunContext(
      task,
      { worktreePath: '/wt', branch: 'feat/x' },
      {
        activeAgents: new Map(),
        defaultModel: 'claude-3-5-sonnet-20241022',
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        onTaskTerminal: vi.fn(),
        repo: mockRepoLocal
      }
    )

    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })
})

describe('consumeMessages', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns streamError when message stream throws a non-auth error', async () => {
    const error = new Error('Stream closed unexpectedly')
    const handle = makeErrorHandle(error)
    const agent: ActiveAgent = {
      taskId: 'task-1',
      agentRunId: 'run-1',
      handle: handle as any,
      model: 'claude-sonnet-4-5',
      startedAt: Date.now(),
      lastOutputAt: Date.now(),
      rateLimitCount: 0,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      maxRuntimeMs: null,
      maxCostUsd: null,
      worktreePath: '/tmp/worktrees/task-1',
      branch: 'agent/task-1'
    }
    const task = makeTask()
    const turnTracker = new TurnTracker('run-1')
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

    const result = await consumeMessages(handle as any, agent, task, 'run-1', turnTracker, logger)

    expect(result.streamError).toBeInstanceOf(Error)
    expect(result.streamError?.message).toBe('Stream closed unexpectedly')
    expect(result.exitCode).toBeUndefined()
    expect(emitAgentEvent).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        type: 'agent:error',
        message: 'Stream interrupted: Stream closed unexpectedly'
      })
    )
  })
})

describe('runAgent — watchdog race: flushAgentEventBatcher', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls flushAgentEventBatcher before returning when watchdog already cleaned up', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { flushAgentEventBatcher } = await import('../../agent-event-mapper')

    const activeAgents = new Map<string, ActiveAgent>()

    const handle = {
      messages: {
        async *[Symbol.asyncIterator]() {
          yield { exit_code: 0 }
          // Simulate watchdog removing the agent before finalizeAgentRun checks
          activeAgents.delete('task-1')
        }
      },
      result: Promise.resolve({ exitCode: 0 })
    }

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(handle)

    const deps = makeDeps({ activeAgents })
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(vi.mocked(flushAgentEventBatcher)).toHaveBeenCalled()
    // Confirm the non-watchdog finalization path was NOT taken:
    // initializeAgentTracking calls updateTask once (to record agent_run_id).
    // resolveAgentExit would call it a second time to transition task status.
    // Exactly 1 call proves the watchdog early-return prevented resolveAgentExit.
    expect(mockRepo.updateTask).toHaveBeenCalledTimes(1)
    expect(mockRepo.updateTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ agent_run_id: expect.any(String) })
    )
    expect(mockRepo.updateTask).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: expect.any(String) })
    )
  })
})

describe('runAgent — stream error: structured event emission', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits agent:error event with "Stream interrupted:" prefix when stream throws', async () => {
    const { spawnAgent } = await import('../sdk-adapter')

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeErrorHandle(new Error('EPIPE: broken pipe'))
    )

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    const streamErrorCalls = vi
      .mocked(emitAgentEvent)
      .mock.calls.filter(([, event]) => event.type === 'agent:error')
    expect(streamErrorCalls).toHaveLength(1)
    expect(streamErrorCalls[0][1]).toMatchObject({
      type: 'agent:error',
      message: 'Stream interrupted: EPIPE: broken pipe'
    })
  })
})
