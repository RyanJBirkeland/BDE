/**
 * success-pipeline.ts — The agent success pipeline.
 *
 * `resolveSuccess` iterates the `successPhases` array. Each named phase
 * handles its own error reporting and throws `PipelineAbortError` to abort
 * the pipeline cleanly without further processing. The orchestrator catches
 * `PipelineAbortError` as a clean stop signal — not a bug.
 */

import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { IUnitOfWork } from '../data/unit-of-work'
import type { Logger } from '../logger'
import type { TaskStatus } from '../../shared/task-state-machine'
import type { TaskStateService } from '../services/task-state-service'
import {
  verifyWorktreeExists,
  detectAgentBranch,
  autoCommitPendingChanges,
  performRebaseOntoMain,
  hasCommitsAheadOfMain,
  transitionTaskToReview
} from './resolve-success-phases'
import { resolveFailure as resolveFailurePhase } from './resolve-failure-phases'
import { evaluateAutoMerge } from './auto-merge-coordinator'
import { listChangedFiles } from './test-touch-check'
import { detectNoOpRun } from './noop-detection'
import { NOOP_RUN_NOTE } from './failure-messages'
import { buildAgentEnv } from '../env-utils'
import { verifyBranchTipOrFail, verifyWorktreeOrFail } from './verification-gate'
import { runPreReviewAdvisors } from './pre-review-advisors'

/**
 * Context passed into the resolveSuccess pipeline from the agent runner.
 * Defined here (not in completion.ts) to avoid circular imports.
 */
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
 * Thrown by a SuccessPhase when it has already handled the error and wants to
 * abort the pipeline without further processing. The orchestrator catches this
 * as a clean stop signal — not a bug.
 */
export class PipelineAbortError extends Error {
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
export interface SuccessPhaseContext extends ResolveSuccessContext {
  logger: Logger
  branch: string
  rebaseOutcome: import('./resolve-success-phases').RebaseOutcome
}

/**
 * A single named step in the agent success pipeline.
 * Returns void on success; throws PipelineAbortError to halt the pipeline.
 */
export interface SuccessPhase {
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
export const successPhases: SuccessPhase[] = [
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
