/**
 * Tests for the ## Files to Change checklist enforcement in run-agent.ts.
 *
 * The check runs after the agent commits and before typecheck/test verification.
 * When listed files are absent from the diff, the task is re-queued with a note.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runAgent } from '../run-agent'
import type { AgentRunClaim, RunAgentDeps } from '../run-agent'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { ActiveAgent } from '../types'
import { DEFAULT_CONFIG } from '../types'

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
  buildAgentPrompt: vi.fn((input) => input.taskContent ?? '')
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

// execFileAsync mock — the key seam. Individual tests override `.mockResolvedValue`
// to control what `git diff --name-only main..HEAD` returns.
vi.mock('../../lib/async-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/async-utils')>()
  return {
    ...actual,
    execFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    sleep: vi.fn().mockResolvedValue(undefined)
  }
})

vi.mock('../../data/sprint-queries', () => ({
  updateTask: vi.fn().mockResolvedValue(undefined),
  forceUpdateTask: vi.fn().mockResolvedValue(undefined)
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

const SPEC_WITH_THREE_FILES = `
## Goal
Add a feature.

## Files to Change
- \`src/main/agent-manager/spec-parser.ts\`
- \`src/main/agent-manager/run-agent.ts\`
- \`src/shared/types/task-types.ts\`

## How to Test
Run npm test.
`

function makeTask(overrides: Partial<AgentRunClaim> = {}): AgentRunClaim {
  return {
    id: 'task-checklist-1',
    title: 'Checklist test task',
    prompt: null,
    spec: SPEC_WITH_THREE_FILES,
    spec_type: 'spec',
    repo: 'bde',
    retry_count: 0,
    fast_fail_count: 0,
    ...overrides
  }
}

const mockRepo: IAgentTaskRepository = {
  getTask: vi.fn(),
  updateTask: vi.fn().mockResolvedValue(null),
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
    defaultModel: DEFAULT_CONFIG.defaultModel,
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
    metrics: { increment: vi.fn(), recordWatchdogVerdict: vi.fn(), setLastDrainDuration: vi.fn(), recordAgentDuration: vi.fn(), snapshot: vi.fn().mockReturnValue({}), reset: vi.fn() },
    worktreeBase: '/tmp/worktrees',
    ...overrides
  }
}

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

const worktree = { worktreePath: '/tmp/wt-checklist', branch: 'agent/t-checklist-1-abc-12345678' }
const repoPath = '/repo'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Files-to-Change checklist enforcement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('re-queues the task when 1 of 3 listed files is missing from the diff', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { resolveSuccess, resolveFailure } = await import('../completion')
    const { execFileAsync } = await import('../../lib/async-utils')

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle())

    // Diff only includes 2 of the 3 required files
    ;(execFileAsync as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string, args: string[]) => {
        if (args.includes('--name-only')) {
          return Promise.resolve({
            stdout:
              'src/main/agent-manager/spec-parser.ts\nsrc/main/agent-manager/run-agent.ts\n',
            stderr: ''
          })
        }
        return Promise.resolve({ stdout: '', stderr: '' })
      }
    )

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    // resolveSuccess should NOT be called — checklist failed
    expect(resolveSuccess).not.toHaveBeenCalled()

    // resolveFailure should be called with a note listing the missing file
    expect(resolveFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-checklist-1',
        notes: expect.stringContaining('src/shared/types/task-types.ts')
      }),
      deps.logger
    )
  })

  it('proceeds normally when all listed files are present in the diff', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { resolveSuccess } = await import('../completion')
    const { execFileAsync } = await import('../../lib/async-utils')

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle())

    // All 3 files are in the diff
    ;(execFileAsync as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string, args: string[]) => {
        if (args.includes('--name-only')) {
          return Promise.resolve({
            stdout: [
              'src/main/agent-manager/spec-parser.ts',
              'src/main/agent-manager/run-agent.ts',
              'src/shared/types/task-types.ts'
            ].join('\n'),
            stderr: ''
          })
        }
        return Promise.resolve({ stdout: '', stderr: '' })
      }
    )

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(resolveSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-checklist-1' }),
      deps.logger
    )
  })

  it('skips the checklist when spec_type is prompt', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { resolveSuccess } = await import('../completion')
    const { execFileAsync } = await import('../../lib/async-utils')

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle())

    // Empty diff — would fail checklist if enforcement ran
    ;(execFileAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: '', stderr: '' })

    const deps = makeDeps()
    await runAgent(makeTask({ spec_type: 'prompt' }), worktree, repoPath, deps)

    // Checklist is skipped, resolveSuccess proceeds normally
    expect(resolveSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-checklist-1' }),
      deps.logger
    )
  })

  it('skips the checklist when the spec has no ## Files to Change section', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { resolveSuccess } = await import('../completion')
    const { execFileAsync } = await import('../../lib/async-utils')

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle())
    ;(execFileAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: '', stderr: '' })

    const specWithoutSection = '## Goal\nDo stuff.\n\n## How to Test\nRun tests.\n'
    const deps = makeDeps()
    await runAgent(makeTask({ spec: specWithoutSection }), worktree, repoPath, deps)

    expect(resolveSuccess).toHaveBeenCalled()
  })

  it('includes all missing paths in the re-queue note', async () => {
    const { spawnAgent } = await import('../sdk-adapter')
    const { resolveFailure } = await import('../completion')
    const { execFileAsync } = await import('../../lib/async-utils')

    ;(spawnAgent as ReturnType<typeof vi.fn>).mockResolvedValue(makeHandle())

    // None of the 3 files are in the diff
    ;(execFileAsync as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string, args: string[]) => {
        if (args.includes('--name-only')) {
          return Promise.resolve({ stdout: 'src/unrelated/file.ts\n', stderr: '' })
        }
        return Promise.resolve({ stdout: '', stderr: '' })
      }
    )

    const deps = makeDeps()
    await runAgent(makeTask(), worktree, repoPath, deps)

    expect(resolveFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: expect.stringMatching(
          /src\/main\/agent-manager\/spec-parser\.ts.*src\/main\/agent-manager\/run-agent\.ts.*src\/shared\/types\/task-types\.ts/s
        )
      }),
      deps.logger
    )
  })
})
