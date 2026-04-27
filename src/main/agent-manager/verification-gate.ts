/**
 * verification-gate.ts — Pre-review verification and branch-tip guards.
 *
 * Exports:
 *   - appendAdvisoryNote — appends a warning string to a task's notes field
 *   - verifyBranchTipOrFail — validates the branch tip references this task
 *   - verifyWorktreeOrFail — runs typecheck + tests; requeues on failure
 */

import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import type { TaskStatus } from '../../shared/task-state-machine'
import type { TaskStateService } from '../services/task-state-service'
import { nowIso } from '../../shared/time'
import { assertBranchTipMatches, BranchTipMismatchError } from './resolve-success-phases'
import { resolveFailure as resolveFailurePhase } from './resolve-failure-phases'
import { verifyWorktreeBuildsAndTests } from './verify-worktree'
import { buildVerificationRevisionFeedback } from './revision-feedback-builder'

/**
 * Appends an advisory line to the task's existing `notes`, preserving any
 * prior notes (e.g. rebase warnings) so multiple advisories can coexist.
 */
export function appendAdvisoryNote(
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
export async function verifyBranchTipOrFail(
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
export async function verifyWorktreeOrFail(opts: {
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
