/**
 * Tests for run-agent.ts failure modes: spawn failures, auth errors,
 * watchdog race, fast-fail paths, and completion fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAgent, detectHtmlWrite, tryEmitPlaygroundEvent } from '../run-agent'
import type { RunAgentTask, RunAgentDeps } from '../run-agent'
import type { ISprintTaskRepository } from '../../data/sprint-task-repository'
import type { ActiveAgent } from '../types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../fast-fail', () => ({
  classifyExit: vi.fn().mockReturnValue('normal-exit')
}))

vi.mock('../worktree', () => ({
  cleanupWorktree: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../sdk-adapter', () => ({
  spawnAgent: vi.fn()
}))

vi.mock('../prompt-composer', () => ({
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
  getGhRepo: vi.fn().mockReturnValue('owner/repo')
}))

vi.mock('../../agent-history', () => ({
  createAgentRecord: vi.fn().mockResolvedValue(undefined),
  updateAgentMeta: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../broadcast', () => ({
  broadcast: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn()
}))

vi.mock('../../env-utils', () => ({
  invalidateOAuthToken: vi.fn(),
  refreshOAuthTokenFromKeychain: vi.fn().mockResolvedValue(false)
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<RunAgentTask> = {}): RunAgentTask {
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

const mockRepo: ISprintTaskRepository = {
  getTask: vi.fn(),
  updateTask: vi.fn().mockReturnValue(null),
  getQueuedTasks: vi.fn(),
  getTasksWithDependencies: vi.fn().mockReturnValue([]),
  getOrphanedTasks: vi.fn(),
  getActiveTaskCount: vi.fn().mockReturnValue(0),
  claimTask: vi.fn()
}

function makeDeps(overrides: Partial<RunAgentDeps> = {}): RunAgentDeps {
  return {
    activeAgents: new Map<string, ActiveAgent>(),
    defaultModel: 'claude-sonnet-4-5',
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
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
      expect.stringContaining('already cleaned up by watchdog')
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

describe('tryEmitPlaygroundEvent', () => {
  beforeEach(() => vi.clearAllMocks())
  it('emits playground event for a valid HTML file', async () => {
    const { stat } = await import('node:fs/promises')
    const { readFile } = await import('node:fs/promises')
    const { broadcast } = await import('../../broadcast')
    vi.mocked(stat).mockResolvedValue({ size: 1024 } as any)
    vi.mocked(readFile).mockResolvedValue('<html>hello</html>')
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    await tryEmitPlaygroundEvent('task-1', '/wt/index.html', '/wt', logger)
    expect(broadcast).toHaveBeenCalledWith(
      'agent:event',
      expect.objectContaining({
        agentId: 'task-1',
        event: expect.objectContaining({
          type: 'agent:playground',
          filename: 'index.html',
          html: expect.any(String)
        })
      })
    )
  })
  it('resolves relative path against worktreePath', async () => {
    const { stat } = await import('node:fs/promises')
    const { readFile } = await import('node:fs/promises')
    vi.mocked(stat).mockResolvedValue({ size: 100 } as any)
    vi.mocked(readFile).mockResolvedValue('<html/>')
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    await tryEmitPlaygroundEvent('task-1', 'relative/file.html', '/wt/path', logger)
    expect(stat).toHaveBeenCalledWith('/wt/path/relative/file.html')
  })
  it('skips file that is too large', async () => {
    const { stat } = await import('node:fs/promises')
    const { broadcast } = await import('../../broadcast')
    vi.mocked(stat).mockResolvedValue({ size: 10 * 1024 * 1024 } as any)
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    await tryEmitPlaygroundEvent('task-1', '/wt/big.html', '/wt', logger)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('File too large'))
    expect(broadcast).not.toHaveBeenCalled()
  })
  it('logs warning on file read error', async () => {
    const { stat } = await import('node:fs/promises')
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    await tryEmitPlaygroundEvent('task-1', '/wt/missing.html', '/wt', logger)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to read HTML file'))
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
    const { buildAgentPrompt } = await import('../prompt-composer')
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
      repoName: 'BDE'
    })
  })

  it('calls spawnAgent with the composed prompt', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { buildAgentPrompt } = await import('../prompt-composer')
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
})
