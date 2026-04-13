/**
 * Review transition — owns the task state update to `review` status.
 *
 * Captures a diff snapshot before updating the task, so Code Review can
 * show changes even after the worktree is eventually cleaned up.
 */
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import { captureDiffSnapshot } from './diff-snapshot'
import { nowIso } from '../../shared/time'

export interface TransitionToReviewOpts {
  taskId: string
  worktreePath: string
  rebaseNote: string | undefined
  rebaseBaseSha: string | undefined
  rebaseSucceeded: boolean
  repo: ISprintTaskRepository
  logger: Logger
}

/**
 * Transition task to review status with diff snapshot and duration calculation.
 * Preserves worktree for human code review.
 */
export async function transitionToReview(opts: TransitionToReviewOpts): Promise<void> {
  const { taskId, worktreePath, rebaseNote, rebaseBaseSha, rebaseSucceeded, repo, logger } = opts
  const task = repo.getTask(taskId)
  let durationMs: number | undefined
  if (task?.started_at) {
    const startTime = new Date(task.started_at).getTime()
    const endTime = Date.now()
    durationMs = endTime - startTime
  }

  let diffSnapshotJson: string | null = null
  try {
    const snapshot = await captureDiffSnapshot(worktreePath, 'origin/main', logger)
    if (snapshot) {
      diffSnapshotJson = JSON.stringify(snapshot)
    }
  } catch (err) {
    logger.warn(`[completion] Diff snapshot capture failed for task ${taskId}: ${err}`)
  }

  try {
    repo.updateTask(taskId, {
      status: 'review',
      worktree_path: worktreePath,
      claimed_by: null,
      ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
      ...(rebaseNote ? { notes: rebaseNote } : {}),
      ...(diffSnapshotJson ? { review_diff_snapshot: diffSnapshotJson } : {}),
      rebase_base_sha: rebaseBaseSha ?? null,
      rebased_at: rebaseSucceeded ? nowIso() : null
    })
  } catch (err) {
    logger.error(`[completion] Failed to update task ${taskId} to review status: ${err}`)
  }
}
