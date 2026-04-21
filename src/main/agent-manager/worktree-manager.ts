/**
 * Worktree manager — periodic worktree pruning and per-task review-status checks.
 *
 * Extracted from AgentManagerImpl._pruneLoop and _isReviewTask so these can
 * be unit-tested without a full manager instance.
 */

import type { Logger } from '../logger'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import { pruneStaleWorktrees } from './worktree'

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface WorktreeManagerDeps {
  worktreeBase: string
  repo: IAgentTaskRepository
  logger: Logger
  isActiveAgent: (taskId: string) => boolean
  isReviewTask: (taskId: string) => boolean
}

// ---------------------------------------------------------------------------
// Review-task guard
// ---------------------------------------------------------------------------

/**
 * Returns true when the task identified by `taskId` is in `review` status.
 * Used by `runPruneLoop` to preserve worktrees for tasks awaiting human review.
 */
export function checkIsReviewTask(taskId: string, repo: IAgentTaskRepository): boolean {
  try {
    const task = repo.getTask(taskId)
    return task?.status === 'review'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Prune loop
// ---------------------------------------------------------------------------

/**
 * Execute one worktree prune pass: remove stale worktrees that are not
 * associated with an active agent or a task in `review` status.
 * Errors propagate to the caller so each call site can attach the
 * appropriate log message (initial prune vs. periodic prune).
 */
export async function runPruneLoop(deps: WorktreeManagerDeps): Promise<void> {
  await pruneStaleWorktrees(deps.worktreeBase, deps.isActiveAgent, deps.logger, deps.isReviewTask)
}
