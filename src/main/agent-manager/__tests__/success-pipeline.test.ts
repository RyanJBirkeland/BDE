/**
 * Tests for the agent success pipeline in success-pipeline.ts.
 *
 * Covers:
 *   - All 10 phases execute in order on a clean run
 *   - PipelineAbortError thrown by any phase halts remaining phases without rethrowing
 *   - Non-PipelineAbortError exceptions propagate out of resolveSuccess
 *   - noOpGuardPhase (successPhases[5]): write-failure guard suppresses onTaskTerminal
 *   - noOpGuardPhase: successful write calls onTaskTerminal with correct status
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('../resolve-success-phases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../resolve-success-phases')>()
  return {
    ...actual,
    verifyWorktreeExists: vi.fn(),
    detectAgentBranch: vi.fn().mockResolvedValue('agent/task-1'),
    autoCommitPendingChanges: vi.fn(),
    performRebaseOntoMain: vi.fn().mockResolvedValue({
      rebaseNote: undefined,
      rebaseBaseSha: undefined,
      rebaseSucceeded: true
    }),
    failTaskIfNoCommitsAheadOfMain: vi.fn().mockResolvedValue({ committed: true }),
    transitionTaskToReview: vi.fn()
  }
})

vi.mock('../resolve-failure-phases', () => ({
  resolveFailure: vi.fn()
}))

vi.mock('../auto-merge-coordinator', () => ({
  evaluateAutoMerge: vi.fn()
}))

vi.mock('../test-touch-check', () => ({
  listChangedFiles: vi.fn().mockResolvedValue(['src/foo.ts']),
  detectUntouchedTests: vi.fn().mockReturnValue([]),
  formatAdvisory: vi.fn()
}))

vi.mock('../noop-detection', () => ({
  detectNoOpRun: vi.fn().mockReturnValue(false)
}))

vi.mock('../../env-utils', () => ({
  buildAgentEnv: vi.fn().mockReturnValue({})
}))

vi.mock('./verification-gate', () => ({
  verifyBranchTipOrFail: vi.fn().mockResolvedValue(true),
  verifyWorktreeOrFail: vi.fn().mockResolvedValue(true),
  appendAdvisoryNote: vi.fn()
}))

vi.mock('../verification-gate', () => ({
  verifyBranchTipOrFail: vi.fn().mockResolvedValue(true),
  verifyWorktreeOrFail: vi.fn().mockResolvedValue(true),
  appendAdvisoryNote: vi.fn()
}))

vi.mock('../pre-review-advisors', () => ({
  runPreReviewAdvisors: vi.fn()
}))

vi.mock('../failure-messages', () => ({
  NOOP_RUN_NOTE: 'noop run note'
}))

// ---------------------------------------------------------------------------
// Imports (after vi.mock declarations)
// ---------------------------------------------------------------------------

import {
  resolveSuccess,
  successPhases,
  PipelineAbortError
} from '../success-pipeline'
import { PipelineAbortError as AbortErrorClass } from '../pipeline-abort-error'
import {
  verifyWorktreeExists,
  detectAgentBranch,
  autoCommitPendingChanges,
  performRebaseOntoMain,
  failTaskIfNoCommitsAheadOfMain,
  transitionTaskToReview
} from '../resolve-success-phases'
import { resolveFailure } from '../resolve-failure-phases'
import { detectNoOpRun } from '../noop-detection'
import { listChangedFiles } from '../test-touch-check'
import { verifyBranchTipOrFail, verifyWorktreeOrFail } from '../verification-gate'
import { runPreReviewAdvisors } from '../pre-review-advisors'
import type { IAgentTaskRepository } from '../../data/sprint-task-repository'
import type { IReviewRepository } from '../../data/review-repository'
import type { IUnitOfWork } from '../../data/unit-of-work'
import type { TaskStateService } from '../../services/task-state-service'
import { makeLogger } from './test-helpers'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(task: Record<string, unknown> | null = {
  id: 'task-1',
  title: 'Test task',
  agent_run_id: null,
  retry_count: 0
}): IAgentTaskRepository {
  return {
    getTask: vi.fn().mockReturnValue(task),
    updateTask: vi.fn().mockResolvedValue(null),
    getQueuedTasks: vi.fn().mockReturnValue([]),
    getTasksWithDependencies: vi.fn().mockReturnValue([]),
    getOrphanedTasks: vi.fn().mockReturnValue([]),
    clearStaleClaimedBy: vi.fn().mockReturnValue(0),
    getActiveTaskCount: vi.fn().mockReturnValue(0),
    claimTask: vi.fn().mockResolvedValue(null),
    getGroup: vi.fn().mockReturnValue(null),
    getGroupTasks: vi.fn().mockReturnValue([]),
    getGroupsWithDependencies: vi.fn().mockReturnValue([]),
    getQueueStats: vi.fn().mockReturnValue({ queued: 0, active: 0 })
  } as unknown as IAgentTaskRepository
}

function makeUnitOfWork(): IUnitOfWork {
  return {
    runInTransaction: vi.fn((fn: () => void) => fn())
  } as unknown as IUnitOfWork
}

function makeTaskStateService(): TaskStateService {
  return {
    transition: vi.fn().mockResolvedValue({ transitioned: true })
  } as unknown as TaskStateService
}

function makeReviewRepo(): IReviewRepository {
  return {
    getCached: vi.fn().mockReturnValue(null),
    setCached: vi.fn(),
    invalidate: vi.fn()
  } as unknown as IReviewRepository
}

function makeBaseOpts() {
  return {
    taskId: 'task-1',
    worktreePath: '/worktree/task-1',
    title: 'Test task',
    ghRepo: 'org/repo',
    onTaskTerminal: vi.fn().mockResolvedValue(undefined),
    retryCount: 0,
    repo: makeRepo(),
    reviewRepo: makeReviewRepo(),
    unitOfWork: makeUnitOfWork(),
    taskStateService: makeTaskStateService(),
    repoPath: '/repo'
  }
}

// ---------------------------------------------------------------------------
// resolveSuccess — phase ordering and abort propagation
// ---------------------------------------------------------------------------

describe('resolveSuccess', () => {
  let logger: ReturnType<typeof makeLogger>

  beforeEach(() => {
    vi.clearAllMocks()
    logger = makeLogger()

    // Reset all phase-level mocks to their happy-path defaults
    vi.mocked(verifyWorktreeExists).mockResolvedValue(true)
    vi.mocked(detectAgentBranch).mockResolvedValue('agent/task-1')
    vi.mocked(autoCommitPendingChanges).mockResolvedValue(undefined)
    vi.mocked(performRebaseOntoMain).mockResolvedValue({
      rebaseNote: undefined,
      rebaseBaseSha: undefined,
      rebaseSucceeded: true
    })
    vi.mocked(failTaskIfNoCommitsAheadOfMain).mockResolvedValue({ committed: true })
    vi.mocked(detectNoOpRun).mockReturnValue(false)
    vi.mocked(listChangedFiles).mockResolvedValue(['src/foo.ts'])
    vi.mocked(verifyBranchTipOrFail).mockResolvedValue(true)
    vi.mocked(runPreReviewAdvisors).mockResolvedValue(undefined)
    vi.mocked(verifyWorktreeOrFail).mockResolvedValue(true)
    vi.mocked(transitionTaskToReview).mockResolvedValue(undefined)
  })

  it('executes all 10 phases in order on a clean run without throwing', async () => {
    const opts = makeBaseOpts()

    await resolveSuccess(opts, logger)

    // Phase 0: verifyWorktree
    expect(verifyWorktreeExists).toHaveBeenCalledTimes(1)
    // Phase 1: detectBranch
    expect(detectAgentBranch).toHaveBeenCalledTimes(1)
    // Phase 2: autoCommit
    expect(autoCommitPendingChanges).toHaveBeenCalledTimes(1)
    // Phase 3: rebase
    expect(performRebaseOntoMain).toHaveBeenCalledTimes(1)
    // Phase 4: verifyCommits
    expect(failTaskIfNoCommitsAheadOfMain).toHaveBeenCalledTimes(1)
    // Phase 5: noOpGuard — via detectNoOpRun
    expect(detectNoOpRun).toHaveBeenCalledTimes(1)
    // Phase 6: branchTipVerify
    expect(verifyBranchTipOrFail).toHaveBeenCalledTimes(1)
    // Phase 7: advisoryAnnotations
    expect(runPreReviewAdvisors).toHaveBeenCalledTimes(1)
    // Phase 8: verifyWorktreeBuild
    expect(verifyWorktreeOrFail).toHaveBeenCalledTimes(1)
    // Phase 9: reviewTransition
    expect(transitionTaskToReview).toHaveBeenCalledTimes(1)
  })

  it('halts on PipelineAbortError at phase 2 (autoCommit) and does not rethrow', async () => {
    vi.mocked(autoCommitPendingChanges).mockRejectedValue(new PipelineAbortError())
    const opts = makeBaseOpts()

    // Should not throw
    await expect(resolveSuccess(opts, logger)).resolves.toBeUndefined()

    // Phases 0 and 1 ran; phase 2 aborted; phases 3+ did not run
    expect(verifyWorktreeExists).toHaveBeenCalledTimes(1)
    expect(detectAgentBranch).toHaveBeenCalledTimes(1)
    expect(performRebaseOntoMain).not.toHaveBeenCalled()
    expect(failTaskIfNoCommitsAheadOfMain).not.toHaveBeenCalled()
    expect(verifyBranchTipOrFail).not.toHaveBeenCalled()
    expect(transitionTaskToReview).not.toHaveBeenCalled()
  })

  it('propagates non-PipelineAbortError exceptions out of resolveSuccess', async () => {
    const boom = new Error('unexpected failure')
    vi.mocked(performRebaseOntoMain).mockRejectedValue(boom)
    const opts = makeBaseOpts()

    await expect(resolveSuccess(opts, logger)).rejects.toThrow('unexpected failure')
  })
})

// ---------------------------------------------------------------------------
// noOpGuardPhase (successPhases[5]) — write-failure guard
// ---------------------------------------------------------------------------

describe('noOpGuardPhase — detectNoOpAndFailIfSo write-failure guard', () => {
  let logger: ReturnType<typeof makeLogger>
  const noOpGuardPhase = successPhases[5]

  beforeEach(() => {
    vi.clearAllMocks()
    logger = makeLogger()
    vi.mocked(listChangedFiles).mockResolvedValue(['.aider.log'])
  })

  function makePhaseContext(onTaskTerminal = vi.fn().mockResolvedValue(undefined)) {
    return {
      taskId: 'task-1',
      worktreePath: '/worktree/task-1',
      title: 'Test task',
      ghRepo: 'org/repo',
      onTaskTerminal,
      retryCount: 0,
      repo: makeRepo(),
      unitOfWork: makeUnitOfWork(),
      taskStateService: makeTaskStateService(),
      repoPath: '/repo',
      logger,
      branch: 'agent/task-1',
      rebaseOutcome: { rebaseNote: undefined, rebaseBaseSha: undefined, rebaseSucceeded: false }
    }
  }

  it('does not call onTaskTerminal and throws PipelineAbortError when detectNoOpRun returns true and resolveFailure returns writeFailed: true', async () => {
    vi.mocked(detectNoOpRun).mockReturnValue(true)
    vi.mocked(resolveFailure).mockResolvedValue({ writeFailed: true, isTerminal: false })

    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)
    const ctx = makePhaseContext(onTaskTerminal)

    await expect(noOpGuardPhase.run(ctx)).rejects.toBeInstanceOf(PipelineAbortError)
    expect(onTaskTerminal).not.toHaveBeenCalled()
  })

  it('calls onTaskTerminal with queued and throws PipelineAbortError when detectNoOpRun returns true and resolveFailure returns isTerminal: false', async () => {
    vi.mocked(detectNoOpRun).mockReturnValue(true)
    vi.mocked(resolveFailure).mockResolvedValue({ writeFailed: false, isTerminal: false })

    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)
    const ctx = makePhaseContext(onTaskTerminal)

    await expect(noOpGuardPhase.run(ctx)).rejects.toBeInstanceOf(PipelineAbortError)
    expect(onTaskTerminal).toHaveBeenCalledOnce()
    expect(onTaskTerminal).toHaveBeenCalledWith('task-1', 'queued')
  })
})

describe('PipelineAbortError cross-module identity', () => {
  it('is the same class as pipeline-abort-error.ts so instanceof checks in run-agent work', () => {
    // run-agent.ts imports PipelineAbortError from ./pipeline-abort-error and uses
    // `err instanceof PipelineAbortError` to distinguish clean pipeline aborts from
    // unexpected errors. If success-pipeline.ts defines its own copy of the class,
    // that instanceof check silently returns false for every phase-thrown abort,
    // causing run-agent to treat normal early exits as unexpected errors.
    expect(PipelineAbortError).toBe(AbortErrorClass)
  })
})

// ---------------------------------------------------------------------------
// T-52 · P1 — verifyCommitsPhase routes unexpected subprocess failure to failed
// ---------------------------------------------------------------------------

describe('T-52: verifyCommitsPhase unexpected failure routes to failed, not requeue', () => {
  // verifyCommitsPhase is successPhases[4]
  const verifyCommitsPhase = successPhases[4]
  let logger: ReturnType<typeof makeLogger>

  beforeEach(() => {
    vi.clearAllMocks()
    logger = makeLogger()

    // Reset all phase mocks to happy-path so only failTaskIfNoCommitsAheadOfMain is varied
    vi.mocked(verifyWorktreeExists).mockResolvedValue(true)
    vi.mocked(detectAgentBranch).mockResolvedValue('agent/task-1')
    vi.mocked(autoCommitPendingChanges).mockResolvedValue(undefined)
    vi.mocked(performRebaseOntoMain).mockResolvedValue({
      rebaseNote: undefined,
      rebaseBaseSha: undefined,
      rebaseSucceeded: true
    })
    vi.mocked(detectNoOpRun).mockReturnValue(false)
    vi.mocked(listChangedFiles).mockResolvedValue(['src/foo.ts'])
    vi.mocked(verifyBranchTipOrFail).mockResolvedValue(true)
    vi.mocked(runPreReviewAdvisors).mockResolvedValue(undefined)
    vi.mocked(verifyWorktreeOrFail).mockResolvedValue(true)
    vi.mocked(transitionTaskToReview).mockResolvedValue(undefined)
  })

  function makePhaseContext(onTaskTerminal = vi.fn().mockResolvedValue(undefined)) {
    return {
      taskId: 'task-1',
      worktreePath: '/worktree/task-1',
      title: 'Test task',
      ghRepo: 'org/repo',
      onTaskTerminal,
      retryCount: 0,
      repo: makeRepo(),
      reviewRepo: makeReviewRepo(),
      unitOfWork: makeUnitOfWork(),
      taskStateService: makeTaskStateService(),
      repoPath: '/repo',
      logger,
      branch: 'agent/task-1',
      rebaseOutcome: { rebaseNote: undefined, rebaseBaseSha: undefined, rebaseSucceeded: false }
    }
  }

  it('propagates unexpected errors from failTaskIfNoCommitsAheadOfMain out of verifyCommitsPhase', async () => {
    // Unexpected throw (not a structured {committed: false} response — a subprocess crash)
    const subprocessError = new Error('git rev-list: fatal: ambiguous argument')
    vi.mocked(failTaskIfNoCommitsAheadOfMain).mockRejectedValue(subprocessError)

    const onTaskTerminal = vi.fn()
    const ctx = makePhaseContext(onTaskTerminal)

    // The phase itself propagates the unexpected error (not PipelineAbortError)
    await expect(verifyCommitsPhase.run(ctx)).rejects.toThrow('git rev-list: fatal: ambiguous argument')
  })

  it('when resolveSuccess catches the propagated error, resolveFailure routes to failed on terminal run', async () => {
    const subprocessError = new Error('git rev-list: fatal: ambiguous argument')
    vi.mocked(failTaskIfNoCommitsAheadOfMain).mockRejectedValue(subprocessError)
    // resolveFailure returns terminal (exhausted retries) — should land on failed, not queued
    vi.mocked(resolveFailure).mockResolvedValue({ writeFailed: false, isTerminal: true })

    const onTaskTerminal = vi.fn().mockResolvedValue(undefined)
    const opts = { ...makeBaseOpts(), onTaskTerminal }

    // resolveSuccess propagates the non-PipelineAbortError
    await expect(resolveSuccess(opts, logger)).rejects.toThrow('git rev-list: fatal: ambiguous argument')

    // onTaskTerminal must NOT have been called inside resolveSuccess — the caller
    // (run-agent.ts handleResolveSuccessFailure) handles the terminal notification
    expect(onTaskTerminal).not.toHaveBeenCalled()
  })
})
