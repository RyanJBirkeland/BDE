/**
 * completion.ts — Thin dispatcher for agent task completion.
 *
 * resolveSuccess() orchestrates the success path (phases in resolve-success-phases.ts).
 * resolveFailure() delegates to resolve-failure-phases.ts.
 * findOrCreatePR() is a re-export for callers that need PR creation from this module.
 *
 * No business logic lives here — this file is the public API surface.
 * All existing imports from other files pointing to completion.ts remain valid.
 */

/** Hard timeout for all git subprocess calls in the completion path. */
const GIT_EXEC_TIMEOUT_MS = 30_000

import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { IUnitOfWork } from '../data/unit-of-work'
import type { Logger } from '../logger'
import type { TaskStatus } from '../../shared/task-state-machine'
import { buildAgentEnv } from '../env-utils'
import { execFileAsync } from '../lib/async-utils'
import { findOrCreatePR as findOrCreatePRUtil } from '../lib/git-operations'
import type { TaskStateService } from '../services/task-state-service'
import {
  verifyWorktreeExists,
  detectAgentBranch,
  autoCommitPendingChanges,
  performRebaseOntoMain,
  hasCommitsAheadOfMain,
  transitionTaskToReview,
  assertBranchTipMatches,
  BranchTipMismatchError
} from './resolve-success-phases'
import { resolveFailure as resolveFailurePhase, type ResolveFailureResult } from './resolve-failure-phases'
import { evaluateAutoMerge } from './auto-merge-coordinator'
import { nowIso } from '../../shared/time'
import { detectUntouchedTests, listChangedFiles, formatAdvisory } from './test-touch-check'
import { detectNoOpRun } from './noop-detection'
import { NOOP_RUN_NOTE } from './failure-messages'
import { verifyWorktreeBuildsAndTests } from './verify-worktree'
import { scanForUnverifiedFacts } from './unverified-facts-scanner'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildVerificationRevisionFeedback } from './revision-feedback-builder'

export type { ResolveFailureContext, ResolveFailureResult } from './resolve-failure-phases'

export interface ResolveSuccessContext {
  taskId: string
  worktreePath: string
  title: string
  ghRepo: string
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
  agentSummary?: string | null
  retryCount: number
  repo: IAgentTaskRepository
  unitOfWork: IUnitOfWork
  taskStateService: TaskStateService
  /**
   * Absolute path to the MAIN repo checkout (not the worktree). Required for
   * branch-tip verification — the tip check reads the branch ref via git log
   * in the main repo. When omitted (legacy callers, tests), branch-tip
   * verification is skipped.
   */
  repoPath?: string
}

/**
 * Exported wrapper for findOrCreatePR from git-operations.
 * Used by review-approve-push flow (push + PR creation deferred from agent completion).
 */
export async function findOrCreatePR(
  worktreePath: string,
  branch: string,
  title: string,
  ghRepo: string,
  logger: Logger
): Promise<{ prUrl: string | null; prNumber: number | null }> {
  const env = buildAgentEnv()
  return findOrCreatePRUtil(worktreePath, branch, title, ghRepo, env, logger)
}

/**
 * Deletes the agent branch in the main repo before the drain loop recreates
 * the worktree on a retry. Swallows errors when the branch doesn't exist —
 * this is defense against a stale branch ref surviving between attempts.
 */
export async function deleteAgentBranchBeforeRetry(
  repoPath: string,
  agentBranch: string,
  logger: Logger
): Promise<void> {
  const env = buildAgentEnv()
  try {
    await execFileAsync('git', ['branch', '-D', agentBranch], { cwd: repoPath, env, timeout: GIT_EXEC_TIMEOUT_MS })
    logger.info(`[completion] deleted agent branch before retry: ${agentBranch}`)
  } catch (err) {
    // Branch may not exist (first-time retry, already cleaned, etc.) — non-fatal.
    logger.info(
      `[completion] branch delete before retry skipped for ${agentBranch}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * Thrown by a SuccessPhase when it has already handled the error and wants to
 * abort the pipeline without further processing. The orchestrator catches this
 * as a clean stop signal — not a bug.
 */
class PipelineAbortError extends Error {
  constructor() {
    super('pipeline aborted')
    this.name = 'PipelineAbortError'
  }
}

/**
 * Mutable accumulator threaded through every SuccessPhase.
 *
 * Guard phases populate fields that later phases depend on. Each phase writes
 * only the fields it owns; reads what prior phases wrote.
 */
interface SuccessPhaseContext extends ResolveSuccessContext {
  logger: Logger
  branch: string
  rebaseOutcome: import('./resolve-success-phases').RebaseOutcome
}

/**
 * A single named step in the agent success pipeline.
 * Returns void on success; throws PipelineAbortError to halt the pipeline.
 */
interface SuccessPhase {
  name: string
  run(ctx: SuccessPhaseContext): Promise<void>
}

const verifyWorktreePhase: SuccessPhase = {
  name: 'verifyWorktree',
  async run(ctx) {
    const exists = await verifyWorktreeExists(
      ctx.taskId,
      ctx.worktreePath,
      ctx.repo,
      ctx.logger,
      ctx.onTaskTerminal,
      ctx.taskStateService
    )
    if (!exists) throw new PipelineAbortError()
  }
}

const detectBranchPhase: SuccessPhase = {
  name: 'detectBranch',
  async run(ctx) {
    const branch = await detectAgentBranch(
      ctx.taskId,
      ctx.worktreePath,
      ctx.repo,
      ctx.logger,
      ctx.onTaskTerminal,
      ctx.taskStateService
    )
    if (!branch) throw new PipelineAbortError()
    ctx.branch = branch
  }
}

const autoCommitPhase: SuccessPhase = {
  name: 'autoCommit',
  async run(ctx) {
    const task = ctx.repo.getTask(ctx.taskId)
    if (!task) {
      ctx.logger.error(`[completion] Task ${ctx.taskId} not found — skipping auto-commit`)
      throw new PipelineAbortError()
    }
    await autoCommitPendingChanges(ctx.taskId, ctx.worktreePath, task, ctx.logger)
  }
}

const rebasePhase: SuccessPhase = {
  name: 'rebase',
  async run(ctx) {
    ctx.rebaseOutcome = await performRebaseOntoMain(ctx.taskId, ctx.worktreePath, ctx.logger)
  }
}

const verifyCommitsPhase: SuccessPhase = {
  name: 'verifyCommits',
  async run(ctx) {
    const hasCommits = await hasCommitsAheadOfMain({
      taskId: ctx.taskId,
      branch: ctx.branch,
      worktreePath: ctx.worktreePath,
      agentSummary: ctx.agentSummary,
      retryCount: ctx.retryCount,
      repo: ctx.repo,
      logger: ctx.logger,
      onTaskTerminal: ctx.onTaskTerminal,
      taskStateService: ctx.taskStateService,
      resolveFailure: resolveFailurePhase
    })
    if (!hasCommits) throw new PipelineAbortError()
  }
}

const noOpGuardPhase: SuccessPhase = {
  name: 'noOpGuard',
  async run(ctx) {
    const isNoOp = await detectNoOpAndFailIfSo(
      ctx.taskId,
      ctx.branch,
      ctx.worktreePath,
      ctx.retryCount,
      ctx.repo,
      ctx.logger,
      ctx.onTaskTerminal
    )
    if (isNoOp) throw new PipelineAbortError()
  }
}

const branchTipVerifyPhase: SuccessPhase = {
  name: 'branchTipVerify',
  async run(ctx) {
    const verified = await verifyBranchTipOrFail(
      ctx.taskId,
      ctx.branch,
      ctx.repoPath,
      ctx.repo,
      ctx.logger,
      ctx.onTaskTerminal,
      ctx.taskStateService
    )
    if (!verified) throw new PipelineAbortError()
  }
}

/**
 * Context passed to each PreReviewAdvisor. Advisory checks read these fields
 * to produce their warnings; they never write to the repository directly.
 */
interface PreReviewAdvisorContext {
  taskId: string
  branch: string
  worktreePath: string
  repoPath: string | undefined
  logger: Logger
}

/**
 * A pluggable advisory check run before the review transition.
 *
 * Returns a warning string (appended to task.notes) or null when nothing to
 * report. Errors are caught by the orchestrator so a flaky check cannot stall
 * the success path.
 */
interface PreReviewAdvisor {
  name: string
  advise(ctx: PreReviewAdvisorContext): Promise<string | null>
}

const untouchedTestsAdvisor: PreReviewAdvisor = {
  name: 'untouchedTests',
  async advise(ctx) {
    const env = buildAgentEnv()
    const changedFiles = await listChangedFiles(ctx.branch, ctx.worktreePath, env, { logger: ctx.logger })
    if (changedFiles.length === 0) return null

    const testCheckRepoPath = ctx.repoPath ?? ctx.worktreePath
    const untouched = detectUntouchedTests(changedFiles, testCheckRepoPath, { logger: ctx.logger })
    if (untouched.length === 0) return null

    return formatAdvisory(untouched)
  }
}

const unverifiedFactsAdvisor: PreReviewAdvisor = {
  name: 'unverifiedFacts',
  async advise(ctx) {
    const env = buildAgentEnv()
    const { stdout: diff } = await execFileAsync('git', ['diff', 'HEAD~1', 'HEAD'], {
      cwd: ctx.worktreePath,
      env,
      timeout: GIT_EXEC_TIMEOUT_MS
    })

    const packageJsonPath = join(ctx.worktreePath, 'package.json')
    const packageJsonContent = await readFile(packageJsonPath, 'utf8').catch(() => '{}')

    const warnings = scanForUnverifiedFacts(diff, packageJsonContent)
    return warnings.length > 0 ? warnings.join('\n') : null
  }
}

/** Registered pre-review advisors — extend by appending to this array. */
const preReviewAdvisors: PreReviewAdvisor[] = [untouchedTestsAdvisor, unverifiedFactsAdvisor]

/**
 * Runs each registered PreReviewAdvisor. Non-null warnings are appended to the
 * task's notes. Errors in individual advisors are caught and logged so a
 * single flaky check cannot stall the success path.
 */
async function runPreReviewAdvisors(
  ctx: PreReviewAdvisorContext,
  repo: IAgentTaskRepository
): Promise<void> {
  for (const advisor of preReviewAdvisors) {
    try {
      const warning = await advisor.advise(ctx)
      if (warning) {
        appendAdvisoryNote(ctx.taskId, warning, repo, ctx.logger)
      }
    } catch (err) {
      ctx.logger.warn(
        `[completion] Advisory check "${advisor.name}" skipped for task ${ctx.taskId}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}

const advisoryAnnotationsPhase: SuccessPhase = {
  name: 'advisoryAnnotations',
  async run(ctx) {
    await runPreReviewAdvisors(
      {
        taskId: ctx.taskId,
        branch: ctx.branch,
        worktreePath: ctx.worktreePath,
        repoPath: ctx.repoPath,
        logger: ctx.logger
      },
      ctx.repo
    )
  }
}

const verifyWorktreeBuildPhase: SuccessPhase = {
  name: 'verifyWorktreeBuild',
  async run(ctx) {
    const verified = await verifyWorktreeOrFail({
      taskId: ctx.taskId,
      worktreePath: ctx.worktreePath,
      retryCount: ctx.retryCount,
      repo: ctx.repo,
      logger: ctx.logger,
      onTaskTerminal: ctx.onTaskTerminal
    })
    if (!verified) throw new PipelineAbortError()
  }
}

const reviewTransitionPhase: SuccessPhase = {
  name: 'reviewTransition',
  async run(ctx) {
    await transitionTaskToReview(
      ctx.taskId,
      ctx.branch,
      ctx.worktreePath,
      ctx.title,
      ctx.rebaseOutcome,
      ctx.repo,
      ctx.unitOfWork,
      ctx.logger,
      ctx.onTaskTerminal,
      evaluateAutoMerge,
      ctx.taskStateService
    )
  }
}

/** Ordered pipeline of named phases executed by resolveSuccess. */
const successPhases: SuccessPhase[] = [
  verifyWorktreePhase,
  detectBranchPhase,
  autoCommitPhase,
  rebasePhase,
  verifyCommitsPhase,
  noOpGuardPhase,
  branchTipVerifyPhase,
  advisoryAnnotationsPhase,
  verifyWorktreeBuildPhase,
  reviewTransitionPhase
]

export async function resolveSuccess(opts: ResolveSuccessContext, logger: Logger): Promise<void> {
  const ctx: SuccessPhaseContext = {
    ...opts,
    logger,
    branch: '',
    rebaseOutcome: { rebaseNote: undefined, rebaseBaseSha: undefined, rebaseSucceeded: false }
  }

  try {
    for (const phase of successPhases) {
      await phase.run(ctx)
    }
  } catch (err) {
    if (!(err instanceof PipelineAbortError)) throw err
  }
}

/**
 * Post-commit guard: if the agent's diff contains only Aider scratch
 * artefacts (`.aider*` files and a `.gitignore` whose only entries are
 * `.aider*` patterns), treat this as a no-op run and fail the task rather
 * than transitioning to `review`. Observed during M8 dogfood when a
 * token-limit wall caused Aider to exit cleanly without modifying source.
 *
 * Returns `true` when the task was failed (caller should stop); `false`
 * when the diff contains legitimate work and the success path continues.
 */
async function detectNoOpAndFailIfSo(
  taskId: string,
  branch: string,
  worktreePath: string,
  retryCount: number,
  repo: IAgentTaskRepository,
  logger: Logger,
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
): Promise<boolean> {
  const env = buildAgentEnv()
  const changedFiles = await listChangedFiles(branch, worktreePath, env, { logger })
  if (!detectNoOpRun(changedFiles, worktreePath)) return false

  logger.event('completion.noop', { taskId, changedFiles })
  logger.warn(
    `[completion] task ${taskId}: detected no-op run on branch ${branch} — failing instead of transitioning to review`
  )
  const result = await resolveFailurePhase({ taskId, retryCount, notes: NOOP_RUN_NOTE, repo }, logger)
  if (result.writeFailed) {
    logger.warn(
      `[completion] task ${taskId}: noop failure DB write failed — skipping terminal notification to avoid corrupting dependency graph`
    )
    return true
  }
  const decision = result.isTerminal ? 'terminal' : 'requeue'
  logger.event('completion.decision', { taskId, decision, reason: 'noop' })
  await onTaskTerminal(taskId, result.isTerminal ? 'failed' : 'queued')
  return true
}

/**
 * Appends an advisory line to the task's existing `notes`, preserving any
 * prior notes (e.g. rebase warnings) so multiple advisories can coexist.
 */
function appendAdvisoryNote(
  taskId: string,
  advisory: string,
  repo: IAgentTaskRepository,
  logger: Logger
): void {
  const existing = repo.getTask(taskId)?.notes ?? ''
  const combined = existing ? `${existing}\n${advisory}` : advisory
  // fire-and-forget: advisory annotation is best-effort
  void repo.updateTask(taskId, { notes: combined }).then(() => {
    logger.info(`[completion] Annotated task ${taskId} with test-touch advisory: ${advisory}`)
  }).catch((err) => {
    logger.warn(`[completion] Failed to persist test-touch advisory for ${taskId}: ${err}`)
  })
}

/**
 * Pre-transition check: the branch tip commit must reference this task.
 * Routes tip-mismatch to `failed` status so the mismatched branch never
 * gets promoted to review. Returns true when the tip is verified (or the
 * check is skipped because no repoPath was supplied — legacy callers).
 */
async function verifyBranchTipOrFail(
  taskId: string,
  branch: string,
  repoPath: string | undefined,
  repo: IAgentTaskRepository,
  logger: Logger,
  _onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>,
  taskStateService: TaskStateService
): Promise<boolean> {
  if (!repoPath) return true

  const task = repo.getTask(taskId)
  if (!task) {
    logger.error(`[completion] Task ${taskId} vanished during tip verification — failing`)
    return false
  }

  try {
    await assertBranchTipMatches(
      { id: task.id, title: task.title, agent_run_id: task.agent_run_id },
      branch,
      repoPath
    )
    return true
  } catch (err) {
    if (err instanceof BranchTipMismatchError) {
      const expectedSummary = err.expectedTokens.join(', ')
      const failureNotes =
        `Branch tip on ${branch} does not reference this task. ` +
        `Expected one of: [${expectedSummary}]. Actual subject: "${err.actualSubject}". ` +
        `This usually means a stale branch or a cross-task leak — task will not be promoted to review.`
      logger.error(`[completion] ${failureNotes}`)
      await taskStateService.transition(taskId, 'failed', {
        fields: {
          completed_at: nowIso(),
          claimed_by: null,
          needs_review: true,
          failure_reason: 'tip-mismatch',
          notes: failureNotes
        },
        caller: 'completion.tip-mismatch'
      })
      return false
    }
    // Non-mismatch error (git missing, branch vanished, etc.) — log and let
    // the task transition to review anyway so the human can diagnose.
    logger.warn(
      `[completion] Branch-tip verification skipped for task ${taskId} due to error: ${err instanceof Error ? err.message : String(err)}`
    )
    return true
  }
}

/**
 * Pre-review verification gate: runs `npm run typecheck` and `npm test` inside
 * the worktree. On failure, requeues the task with the tool's stderr in notes
 * so the retry agent sees the exact error. Returns `true` when verification
 * passes (caller should proceed to transition); `false` when the task has been
 * requeued or marked failed.
 */
async function verifyWorktreeOrFail(opts: {
  taskId: string
  worktreePath: string
  retryCount: number
  repo: IAgentTaskRepository
  logger: Logger
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
}): Promise<boolean> {
  const { taskId, worktreePath, retryCount, repo, logger, onTaskTerminal } = opts

  const result = await verifyWorktreeBuildsAndTests(worktreePath, logger)
  if (result.ok) return true

  logger.warn(
    `[completion] task ${taskId}: pre-review verification failed (${result.failure.kind}) — requeueing instead of transitioning to review`
  )

  const feedback = buildVerificationRevisionFeedback(result.failure.kind, result.failure.stderr)
  const notes = JSON.stringify(feedback)

  const failureResult = await resolveFailurePhase({ taskId, retryCount, notes, repo }, logger)
  if (failureResult.writeFailed) {
    logger.warn(
      `[completion] task ${taskId}: verification failure DB write failed — skipping terminal notification to avoid corrupting dependency graph`
    )
    return false
  }
  const decision = failureResult.isTerminal ? 'terminal' : 'requeue'
  logger.event('completion.decision', { taskId, decision, reason: result.failure.kind })
  await onTaskTerminal(taskId, failureResult.isTerminal ? 'failed' : 'queued')
  return false
}

export async function resolveFailure(
  opts: {
    taskId: string
    retryCount: number
    notes?: string | undefined
    repo: IAgentTaskRepository
  },
  logger?: Logger
): Promise<ResolveFailureResult> {
  return resolveFailurePhase(opts, logger)
}
