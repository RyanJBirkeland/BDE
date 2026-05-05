/**
 * verification-gate.ts — Pre-review verification and branch-tip guards.
 *
 * Exports:
 *   - capOutput — pure helper: truncates text to a character cap
 *   - toVerificationRecord — pure helper: converts a CommandResult to a VerificationRecord
 *   - appendAdvisoryNote — appends a warning string to a task's notes field
 *   - verifyBranchTipOrFail — validates the branch tip references this task
 *   - verifyWorktreeOrFail — runs typecheck + tests; persists results; requeues on failure
 */

import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import type { TaskStatus } from '../../shared/task-state-machine'
import type { TaskStateService } from '../services/task-state-service'
import type { VerificationRecord, VerificationResults } from '../../shared/types/task-types'
import { nowIso } from '../../shared/time'
import { assertBranchTipMatches, BranchTipMismatchError } from './resolve-success-phases'
import { resolveFailure as resolveFailurePhase, type ResolveFailureContext } from './resolve-failure-phases'
import {
  verifyWorktreeBuildsAndTests,
  type CommandResult,
  type WorktreeVerificationOutput,
  type VerificationFailureKind
} from './verify-worktree'
import { buildVerificationRevisionFeedback } from './revision-feedback-builder'
import { VERIFICATION_OUTPUT_CAP } from './prompt-constants'

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing
// ---------------------------------------------------------------------------

/** Truncates text to at most cap characters. Returns both the result and whether it was cut. */
export function capOutput(text: string, cap: number): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false }
  return { text: text.slice(0, cap), truncated: true }
}

/** Converts a raw CommandResult into a VerificationRecord, capping stdout and stderr. */
export function toVerificationRecord(result: CommandResult): VerificationRecord {
  const cappedStdout = capOutput(result.stdout, VERIFICATION_OUTPUT_CAP)
  const cappedStderr = capOutput(result.stderr, VERIFICATION_OUTPUT_CAP)
  return {
    exitCode: result.ok ? 0 : 1,
    stdout: cappedStdout.text,
    stderr: cappedStderr.text,
    truncated: cappedStdout.truncated || cappedStderr.truncated,
    durationMs: result.durationMs,
    timestamp: new Date().toISOString()
  }
}

function buildVerificationResults(output: WorktreeVerificationOutput): VerificationResults {
  return {
    typecheck: output.typecheck ? toVerificationRecord(output.typecheck) : null,
    tests: output.tests ? toVerificationRecord(output.tests) : null
  }
}

// ---------------------------------------------------------------------------
// Advisory notes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Branch-tip guard
// ---------------------------------------------------------------------------

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
  taskStateService: TaskStateService
): Promise<boolean> {
  if (!repoPath) {
    logger.warn('[verification-gate] branch-tip check skipped — repoPath absent')
    return true
  }

  const task = repo.getTask(taskId)
  if (!task) {
    logger.error(`[completion] Task ${taskId} vanished during tip verification — failing`)
    return false
  }

  try {
    await assertBranchTipMatches(
      { id: task.id, title: task.title, agent_run_id: task.agent_run_id, group_id: task.group_id ?? null },
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

// ---------------------------------------------------------------------------
// Worktree verification gate
// ---------------------------------------------------------------------------

/**
 * Pre-review verification gate: runs `npm run typecheck` and `npm test` inside
 * the worktree. Persists the raw output to `verification_results` on the task
 * regardless of outcome so the reviewer always sees what the gate observed.
 * On failure, requeues the task with the tool's stderr in notes so the retry
 * agent sees the exact error. Returns `true` when verification passes (caller
 * should proceed to transition); `false` when the task has been requeued or
 * marked failed.
 */
export async function verifyWorktreeOrFail(opts: {
  taskId: string
  worktreePath: string
  retryCount: number
  repo: IAgentTaskRepository
  logger: Logger
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
  taskStateService: TaskStateService
}): Promise<boolean> {
  const { taskId, worktreePath, retryCount, repo, logger, onTaskTerminal, taskStateService } = opts

  const output = await verifyWorktreeBuildsAndTests(worktreePath, logger)

  // Persist gate results for the reviewer regardless of outcome.
  // Promise.resolve() guards against mocks or legacy repo implementations that return null/void.
  void Promise.resolve(
    repo.updateTask(taskId, { verification_results: buildVerificationResults(output) })
  ).catch((err: unknown) => {
    logger.warn(`[completion] task ${taskId}: failed to persist verification_results — ${err}`)
  })

  const typecheckFailed = output.typecheck?.ok === false
  const testsFailed = output.tests?.ok === false
  const failed = typecheckFailed || testsFailed

  if (!failed) return true

  const failedResult = typecheckFailed ? output.typecheck! : output.tests!
  const failureKind: VerificationFailureKind = typecheckFailed ? 'compilation' : 'test_failure'

  logger.warn(
    `[completion] task ${taskId}: pre-review verification failed (${failureKind}) — requeueing`
  )

  const combinedOutput = [failedResult.stderr, failedResult.stdout]
    .filter((s) => s.length > 0)
    .join('\n')
  const feedback = buildVerificationRevisionFeedback(failureKind, combinedOutput)
  const notes = JSON.stringify(feedback)

  const failureOpts: ResolveFailureContext = { taskId, retryCount, notes, repo, taskStateService }
  const failureResult = await resolveFailurePhase(failureOpts, logger)
  if (failureResult.writeFailed) {
    logger.warn(
      `[completion] task ${taskId}: verification failure DB write failed — skipping terminal notification`
    )
    return false
  }
  const decision = failureResult.isTerminal ? 'terminal' : 'requeue'
  logger.event('completion.decision', { taskId, decision, reason: failureKind })
  await onTaskTerminal(taskId, failureResult.isTerminal ? 'failed' : 'queued')
  return false
}
