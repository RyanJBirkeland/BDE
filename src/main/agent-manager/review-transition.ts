/**
 * Review transition — owns the task state update to `review` status.
 *
 * Captures a diff snapshot before updating the task, so Code Review can
 * show changes even after the worktree is eventually cleaned up.
 */
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import { captureDiffSnapshot } from './diff-snapshot'
import { nowIso } from '../../shared/time'
import type { TaskStateService } from '../services/task-state-service'
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'
import { resolveDefaultBranch } from '../lib/default-branch'
import { notifySprintMutation } from '../services/sprint-mutation-broadcaster'

/** Hard timeout for git subprocess calls in the review transition. */
const GIT_EXEC_TIMEOUT_MS = 30_000

/**
 * Counts commits on the agent's branch ahead of the repo's default branch.
 * Returns `undefined` when the count cannot be obtained — the caller should
 * treat that as "diagnostic-only data missing" and proceed.
 */
async function countCommitsAheadOfMain(
  worktreePath: string,
  logger: Logger
): Promise<number | undefined> {
  try {
    const env = buildAgentEnv()
    const defaultBranch = await resolveDefaultBranch(worktreePath)
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', '--count', `origin/${defaultBranch}..HEAD`],
      { cwd: worktreePath, env, timeout: GIT_EXEC_TIMEOUT_MS }
    )
    const parsed = parseInt(stdout.trim(), 10)
    return Number.isFinite(parsed) ? parsed : undefined
  } catch (err) {
    logger.warn(
      `[completion] Commit count for review-transition log unavailable: ${err instanceof Error ? err.message : String(err)}`
    )
    return undefined
  }
}

export interface TransitionToReviewOpts {
  taskId: string
  worktreePath: string
  rebaseNote: string | undefined
  rebaseBaseSha: string | undefined
  rebaseSucceeded: boolean
  repo: IAgentTaskRepository
  logger: Logger
  taskStateService: TaskStateService
}

/**
 * Transition task to review status with diff snapshot and duration calculation.
 * Preserves worktree for human code review.
 */
export async function transitionToReview(opts: TransitionToReviewOpts): Promise<void> {
  const {
    taskId,
    worktreePath,
    rebaseNote,
    rebaseBaseSha,
    rebaseSucceeded,
    repo,
    logger,
    taskStateService
  } = opts

  const commitsAhead = await countCommitsAheadOfMain(worktreePath, logger)
  logger.event('completion.review_transition', {
    taskId,
    rebaseSucceeded,
    hasRebaseNote: rebaseNote !== undefined,
    commitsAhead: commitsAhead ?? null
  })

  const task = repo.getTask(taskId)
  let durationMs: number | undefined
  if (task?.started_at) {
    const startTime = new Date(task.started_at).getTime()
    const endTime = Date.now()
    durationMs = endTime - startTime
  }

  let diffSnapshotJson: string | null = null
  try {
    const defaultBranch = await resolveDefaultBranch(worktreePath)
    const snapshot = await captureDiffSnapshot(worktreePath, `origin/${defaultBranch}`, logger)
    if (snapshot) {
      diffSnapshotJson = JSON.stringify(snapshot)
    }
  } catch (err) {
    logger.warn(`[completion] Diff snapshot capture failed for task ${taskId}: ${err}`)
  }

  try {
    await taskStateService.transition(taskId, 'review', {
      fields: {
        worktree_path: worktreePath,
        claimed_by: null,
        fast_fail_count: 0,
        promoted_to_review_at: nowIso(),
        ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
        ...(rebaseNote ? { notes: rebaseNote } : {}),
        ...(diffSnapshotJson ? { review_diff_snapshot: diffSnapshotJson } : {}),
        rebase_base_sha: rebaseBaseSha ?? null,
        rebased_at: rebaseSucceeded ? nowIso() : null
      },
      caller: 'review-transition'
    })
    const updated = repo.getTask(taskId)
    if (updated) notifySprintMutation('updated', updated)
  } catch (err) {
    logger.event('review-transition.fallback', { taskId, error: String(err) })
    logger.error(`[completion] Failed to transition task ${taskId} to review status: ${err}`)
    // Fall back to failed so the task does not stay stuck active
    try {
      await taskStateService.transition(taskId, 'failed', {
        fields: { failure_reason: 'review-transition-failed', claimed_by: null },
        caller: 'review-transition.fallback'
      })
    } catch (fallbackErr) {
      logger.error(
        `[completion] Fallback failed transition also failed for task ${taskId}: ${fallbackErr}`
      )
    }
  }
}
