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
import { resolveFailure as resolveFailurePhase } from './resolve-failure-phases'
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

export type { ResolveFailureContext } from './resolve-failure-phases'

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

export async function resolveSuccess(opts: ResolveSuccessContext, logger: Logger): Promise<void> {
  const {
    taskId,
    worktreePath,
    title,
    onTaskTerminal,
    agentSummary,
    retryCount,
    repo,
    unitOfWork,
    repoPath,
    taskStateService
  } = opts

  const worktreeExists = await verifyWorktreeExists(
    taskId,
    worktreePath,
    repo,
    logger,
    onTaskTerminal,
    taskStateService
  )
  if (!worktreeExists) return

  const branch = await detectAgentBranch(
    taskId,
    worktreePath,
    repo,
    logger,
    onTaskTerminal,
    taskStateService
  )
  if (!branch) return

  const task = repo.getTask(taskId)
  if (!task) {
    logger.error(`[completion] Task ${taskId} not found — skipping auto-commit`)
    return
  }
  await autoCommitPendingChanges(taskId, worktreePath, task, logger)

  const rebaseOutcome = await performRebaseOntoMain(taskId, worktreePath, logger)

  const hasCommits = await hasCommitsAheadOfMain({
    taskId,
    branch,
    worktreePath,
    agentSummary,
    retryCount,
    repo,
    logger,
    onTaskTerminal,
    resolveFailure: resolveFailurePhase
  })
  if (!hasCommits) return

  const isNoOp = await detectNoOpAndFailIfSo(
    taskId,
    branch,
    worktreePath,
    retryCount,
    repo,
    logger,
    onTaskTerminal
  )
  if (isNoOp) return

  const tipVerified = await verifyBranchTipOrFail(
    taskId,
    branch,
    repoPath,
    repo,
    logger,
    onTaskTerminal
  )
  if (!tipVerified) return

  await annotateIfTestsUntouched(taskId, branch, worktreePath, repoPath, repo, logger)
  await annotateUnverifiedFacts(taskId, worktreePath, repo, logger)

  const verified = await verifyWorktreeOrFail({
    taskId,
    worktreePath,
    retryCount,
    repo,
    logger,
    onTaskTerminal
  })
  if (!verified) return

  await transitionTaskToReview(
    taskId,
    branch,
    worktreePath,
    title,
    rebaseOutcome,
    repo,
    unitOfWork,
    logger,
    onTaskTerminal,
    evaluateAutoMerge,
    taskStateService
  )
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

  logger.warn(
    `[completion] task ${taskId}: detected no-op run on branch ${branch} — failing instead of transitioning to review`
  )
  const isTerminal = resolveFailurePhase({ taskId, retryCount, notes: NOOP_RUN_NOTE, repo }, logger)
  await onTaskTerminal(taskId, isTerminal ? 'failed' : 'queued')
  return true
}

/**
 * Pre-review advisory: checks whether the agent changed source files whose
 * sibling test files exist but were not also changed. Appends a single-line
 * warning to the task's `notes` so the human reviewer sees it in Code Review.
 *
 * Intentionally advisory-only — never blocks the review transition. Failures
 * in git diff or fs lookups are logged and swallowed so a flaky check cannot
 * stall the success path.
 */
async function annotateIfTestsUntouched(
  taskId: string,
  agentBranch: string,
  worktreePath: string,
  repoPath: string | undefined,
  repo: IAgentTaskRepository,
  logger: Logger
): Promise<void> {
  const testCheckRepoPath = repoPath ?? worktreePath
  const env = buildAgentEnv()

  try {
    const changedFiles = await listChangedFiles(agentBranch, worktreePath, env, { logger })
    if (changedFiles.length === 0) return

    const untouched = detectUntouchedTests(changedFiles, testCheckRepoPath, { logger })
    if (untouched.length === 0) return

    appendAdvisoryNote(taskId, formatAdvisory(untouched), repo, logger)
  } catch (err) {
    logger.warn(
      `[completion] Untouched-test check skipped for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * Post-commit advisory: diffs the last commit against its parent, then scans
 * the diff for heuristic signals of fabricated external references — unknown
 * brew tap installs, npm global packages not in package.json, unrecognised
 * URLs, and pipe-to-shell patterns. Each finding is appended to the task's
 * `notes` as a separate line so the human reviewer sees them in Code Review.
 *
 * Never throws, never blocks the success path.
 */
async function annotateUnverifiedFacts(
  taskId: string,
  worktreePath: string,
  repo: IAgentTaskRepository,
  logger: Logger
): Promise<void> {
  try {
    const env = buildAgentEnv()
    const { stdout: diff } = await execFileAsync('git', ['diff', 'HEAD~1', 'HEAD'], {
      cwd: worktreePath,
      env,
      timeout: GIT_EXEC_TIMEOUT_MS
    })

    const packageJsonPath = join(worktreePath, 'package.json')
    const packageJsonContent = await readFile(packageJsonPath, 'utf8').catch(() => '{}')

    const warnings = scanForUnverifiedFacts(diff, packageJsonContent)
    if (warnings.length === 0) return

    for (const warning of warnings) {
      appendAdvisoryNote(taskId, warning, repo, logger)
    }
  } catch (err) {
    logger.warn(
      `[completion] Unverified-facts scan skipped for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
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
  try {
    const existing = repo.getTask(taskId)?.notes ?? ''
    const combined = existing ? `${existing}\n${advisory}` : advisory
    repo.updateTask(taskId, { notes: combined })
    logger.info(`[completion] Annotated task ${taskId} with test-touch advisory: ${advisory}`)
  } catch (err) {
    logger.warn(`[completion] Failed to persist test-touch advisory for ${taskId}: ${err}`)
  }
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
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
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
      try {
        repo.updateTask(taskId, {
          status: 'failed',
          completed_at: nowIso(),
          claimed_by: null,
          needs_review: true,
          failure_reason: 'tip-mismatch',
          notes: failureNotes
        })
      } catch (updateErr) {
        logger.error(
          `[completion] Failed to persist tip-mismatch status for task ${taskId}: ${updateErr}`
        )
      }
      await onTaskTerminal(taskId, 'failed')
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

  const isTerminal = resolveFailurePhase({ taskId, retryCount, notes, repo }, logger)
  await onTaskTerminal(taskId, isTerminal ? 'failed' : 'queued')
  return false
}

export function resolveFailure(
  opts: {
    taskId: string
    retryCount: number
    notes?: string | undefined
    repo: IAgentTaskRepository
  },
  logger?: Logger
): boolean {
  return resolveFailurePhase(opts, logger)
}
