/**
 * Integration test: when resolveSuccess triggers pre-review verification and
 * that verification fails, task.notes must contain valid RevisionFeedback JSON.
 *
 * Tests the full path:
 *   verifyWorktreeBuildsAndTests (injectable) → buildVerificationRevisionFeedback
 *   → resolveFailurePhase({ notes: JSON.stringify(feedback) })
 *   → repo.updateTask({ notes: <structured JSON> })
 *
 * The resolveSuccess path is tested here via its `completion` surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'node:util'
import { parseRevisionFeedback } from '../revision-feedback-builder'

// Node fs / child_process mocks required by completion.ts and its dependencies.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, existsSync: vi.fn(() => true) }
})

vi.mock('node:child_process', () => {
  const execFile = vi.fn() as ReturnType<typeof vi.fn> & { [k: symbol]: unknown }
  execFile[promisify.custom] = vi.fn()
  return { execFile }
})

vi.mock('../../data/sprint-queries', () => ({
  updateTask: vi.fn(),
  forceUpdateTask: vi.fn()
}))

vi.mock('../../broadcast', () => ({
  broadcast: vi.fn(),
  broadcastCoalesced: vi.fn()
}))

import { execFile } from 'node:child_process'
import { updateTask } from '../../data/sprint-queries'
import { resolveSuccess } from '../completion'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'

const execFileMock = vi.mocked(execFile)
const updateTaskMock = vi.mocked(updateTask)

function getCustomMock(): ReturnType<typeof vi.fn> {
  return (execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[promisify.custom]
}

function mockExecFileSequence(responses: Array<{ stdout?: string; error?: Error }>) {
  let callIndex = 0
  getCustomMock().mockImplementation((..._args: unknown[]) => {
    const resp = responses[callIndex] ?? { stdout: '' }
    callIndex++
    if (resp.error) return Promise.reject(resp.error)
    return Promise.resolve({ stdout: resp.stdout ?? '', stderr: '' })
  })
}

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), event: vi.fn() }

let capturedNotes: string | undefined

const mockRepo: IAgentTaskRepository = {
  getTask: vi.fn().mockReturnValue({ id: 'task-1', title: 'Test task', started_at: new Date().toISOString() }),
  updateTask: vi.fn().mockImplementation((_id: string, patch: Record<string, unknown>) => {
    if (patch.notes && typeof patch.notes === 'string') capturedNotes = patch.notes
    return null
  }),
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

const mockTaskStateService = {
  transition: vi.fn(async (_taskId: string, _status: string, ctx?: { fields?: Record<string, unknown> }) => {
    // Delegate notes writes to mockRepo so capturedNotes is populated via the repo mock.
    if (ctx?.fields?.notes) {
      mockRepo.updateTask(_taskId, ctx.fields)
    }
    return { committed: true, dependentsResolved: true }
  })
}

const baseOpts = {
  taskId: 'task-1',
  worktreePath: '/tmp/worktrees/task-1',
  title: 'Test task',
  ghRepo: 'owner/repo',
  onTaskTerminal: vi.fn().mockResolvedValue(undefined),
  retryCount: 0,
  repo: mockRepo,
  unitOfWork: { runInTransaction: (fn: () => void) => fn() },
  taskStateService: mockTaskStateService as any
}

beforeEach(() => {
  capturedNotes = undefined
  getCustomMock().mockReset()
  updateTaskMock.mockReset()
  updateTaskMock.mockReturnValue(null)
  vi.mocked(mockRepo.updateTask).mockImplementation(
    (_id: string, patch: Record<string, unknown>) => {
      if (patch.notes && typeof patch.notes === 'string') capturedNotes = patch.notes
      return null
    }
  )
  vi.mocked(baseOpts.onTaskTerminal).mockReset().mockResolvedValue(undefined)
  mockTaskStateService.transition.mockReset()
  mockTaskStateService.transition.mockImplementation(
    async (_taskId: string, _status: string, ctx?: { fields?: Record<string, unknown> }) => {
      if (ctx?.fields?.notes) {
        mockRepo.updateTask(_taskId, ctx.fields)
      }
      return { committed: true, dependentsResolved: true }
    }
  )
})

// ---------------------------------------------------------------------------
// Helpers — simulate the git command sequence that precedes verification
// ---------------------------------------------------------------------------

/**
 * Git sequence for a branch with commits that reaches the verification gate.
 * The verify-worktree module uses its own execFileAsync (injectable), so we
 * stub it separately via the verify-worktree mock.
 */
function mockGitSequenceWithCommits() {
  mockExecFileSequence([
    { stdout: 'agent/test-task-abc12345\n' }, // git rev-parse (branch)
    { stdout: '' },                            // git status --porcelain (clean)
    { stdout: '' },                            // git fetch origin main
    { stdout: '' },                            // git rebase origin/main
    { stdout: 'abc123\n' },                    // git rev-parse origin/main (rebase base SHA)
    { stdout: '1\n' },                         // git rev-list --count (has commits)
    { stdout: '' },                            // git diff --name-only (noop check)
    { stdout: 'agent/test-task-abc12345\n' },  // git log -1 --format=%B (branch-tip check — matches)
    { stdout: '' },                            // git diff --name-only (test-touch check)
  ])
}

// ---------------------------------------------------------------------------
// Verification mock
// ---------------------------------------------------------------------------

vi.mock('../verify-worktree', async () => {
  const actual = await vi.importActual<typeof import('../verify-worktree')>('../verify-worktree')
  return {
    ...actual,
    verifyWorktreeBuildsAndTests: vi.fn()
  }
})

import { verifyWorktreeBuildsAndTests } from '../verify-worktree'
const mockVerify = vi.mocked(verifyWorktreeBuildsAndTests)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveSuccess → verification_failed → structured notes', () => {
  it('stores RevisionFeedback JSON in task.notes on compilation failure', async () => {
    mockGitSequenceWithCommits()
    mockVerify.mockResolvedValue({
      ok: false,
      failure: {
        kind: 'compilation',
        stderr: 'src/foo.ts(10,5): error TS2304: Cannot find name "Bar".'
      }
    })

    await resolveSuccess(baseOpts, noopLogger)

    expect(capturedNotes).toBeDefined()
    const feedback = parseRevisionFeedback(capturedNotes)
    expect(feedback).not.toBeNull()
    expect(feedback!.diagnostics[0]!.kind).toBe('typecheck')
    expect(feedback!.diagnostics[0]!.file).toBe('src/foo.ts')
    expect(feedback!.diagnostics[0]!.line).toBe(10)
  })

  it('stores RevisionFeedback JSON in task.notes on test failure', async () => {
    mockGitSequenceWithCommits()
    mockVerify.mockResolvedValue({
      ok: false,
      failure: {
        kind: 'test_failure',
        stderr: 'FAIL src/main/agent-manager/__tests__/foo.test.ts\n  expected 1 to equal 2'
      }
    })

    await resolveSuccess(baseOpts, noopLogger)

    expect(capturedNotes).toBeDefined()
    const feedback = parseRevisionFeedback(capturedNotes)
    expect(feedback).not.toBeNull()
    expect(feedback!.diagnostics.some((d) => d.kind === 'test')).toBe(true)
  })

  it('produces valid JSON that round-trips through parseRevisionFeedback', async () => {
    mockGitSequenceWithCommits()
    mockVerify.mockResolvedValue({
      ok: false,
      failure: {
        kind: 'compilation',
        stderr: 'src/bar.ts(1,1): error TS2345: Argument of type "x" is not assignable to type "y".'
      }
    })

    await resolveSuccess(baseOpts, noopLogger)

    expect(capturedNotes).toBeDefined()
    // parseRevisionFeedback must not throw and must return non-null
    const roundTripped = parseRevisionFeedback(capturedNotes)
    expect(roundTripped).not.toBeNull()
    expect(roundTripped!.summary.length).toBeGreaterThan(0)
    expect(roundTripped!.diagnostics.length).toBeGreaterThan(0)
  })
})
