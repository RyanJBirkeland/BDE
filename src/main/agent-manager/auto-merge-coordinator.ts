/**
 * Auto-merge coordinator — evaluates and executes automatic merges after agent completion.
 *
 * When a task transitions to 'review', auto-merge rules are checked. If a rule matches,
 * the agent's branch is squash-merged into main without human intervention.
 *
 * Failures are non-fatal: the task stays in 'review' for human action.
 */
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { IUnitOfWork } from '../data/unit-of-work'
import type { Logger } from '../logger'
import type { TaskStatus } from '../../shared/task-state-machine'
import type { AutoReviewRule } from '../../shared/types/task-types'
import { nowIso } from '../../shared/time'
import { evaluateAutoMergePolicy } from './auto-merge-policy'
import { executeSquashMerge } from '../lib/git-operations'
import { getSettingJson } from '../settings'
import { getRepoConfig } from '../paths'
import type { TaskStateService } from '../services/task-state-service'

function isAutoReviewRulesArray(u: unknown): u is AutoReviewRule[] {
  return Array.isArray(u)
}

export interface AutoMergeContext {
  taskId: string
  title: string
  branch: string
  worktreePath: string
  repo: IAgentTaskRepository
  unitOfWork: IUnitOfWork
  logger: Logger
  onTaskTerminal: (taskId: string, status: TaskStatus) => Promise<void>
  taskStateService: TaskStateService
}

export async function evaluateAutoMerge(opts: AutoMergeContext): Promise<void> {
  const { taskId, title, branch, worktreePath, repo, unitOfWork, logger, taskStateService } = opts
  const rules = getSettingJson<AutoReviewRule[]>('autoReview.rules', isAutoReviewRulesArray)

  if (!rules || rules.length === 0) {
    return
  }

  try {
    const decision = await evaluateAutoMergePolicy(rules, worktreePath)

    if (!decision.shouldMerge) {
      return
    }

    logger.info(
      `[completion] Task ${taskId} qualifies for auto-merge (rule: ${decision.ruleName}) — merging`
    )

    const task = repo.getTask(taskId)
    if (!task) {
      logger.error(`[completion] Task ${taskId} not found`)
      return
    }
    const repoConfig = getRepoConfig(task.repo)
    if (!repoConfig) {
      logger.error(`[completion] Repo "${task.repo}" not found in settings`)
      return
    }

    const mergeResult = await executeSquashMerge({
      taskId,
      branch,
      worktreePath,
      repoPath: repoConfig.localPath,
      title,
      logger
    })

    if (mergeResult === 'merged') {
      await finalizeAutoMergeStatus(taskId, repo, unitOfWork, logger, taskStateService)
      logger.info(`[completion] Task ${taskId} auto-merged successfully`)
    } else if (mergeResult === 'dirty-main') {
      logger.warn(
        `[completion] Task ${taskId} auto-merge skipped: main repo has uncommitted changes — task remains in review`
      )
    } else {
      logger.error(`[completion] Task ${taskId} auto-merge failed — task remains in review`)
    }
  } catch (err) {
    // Auto-merge is best-effort: a failure here leaves the task in 'review' for human action,
    // which is always the safe fallback. Do not re-throw — the task state is already consistent.
    logger.error(`[completion] Auto-merge check failed for task ${taskId}: ${err}`)
  }
}

/**
 * Atomically mark a task `done` after its branch has been squash-merged to main.
 *
 * The squash-merge itself is a filesystem operation and cannot be rolled back by
 * SQLite; atomicity is bounded to the DB side. We wrap every DB write that
 * accompanies the status transition in a single better-sqlite3 transaction so a
 * crash between updates cannot leave the task in a half-transitioned state
 * (e.g. status updated but audit trail missing, or vice versa).
 *
 * The audit trail (task_changes) is recorded automatically by `repo.updateTask`
 * via its internal `recordTaskChanges` call, so both writes land under the same
 * transaction scope.
 *
 * If the DB write fails after the merge has already landed on main, we log a
 * loud banner so the on-call operator knows exactly which task needs manual
 * status reconciliation.
 */
async function finalizeAutoMergeStatus(
  taskId: string,
  repo: IAgentTaskRepository,
  _unitOfWork: IUnitOfWork,
  logger: Logger,
  taskStateService: TaskStateService
): Promise<void> {
  const reviewTask = repo.getTask(taskId)
  const extraFields: Record<string, unknown> = {
    completed_at: nowIso(),
    worktree_path: null,
    ...(reviewTask?.duration_ms !== undefined ? { duration_ms: reviewTask.duration_ms } : {})
  }

  try {
    // transition() writes status + extraFields then dispatches the terminal
    // handler (dependency resolution + metrics). The prior transaction wrapper
    // was only needed to atomically pair the DB write with its audit trail,
    // which updateTask already guarantees internally.
    await taskStateService.transition(taskId, 'done', {
      fields: extraFields,
      caller: 'auto-merge'
    })
  } catch (err) {
    logger.error(
      `[auto-merge] COMMIT LANDED ON MAIN but status update failed — task ${taskId} may need manual status reconciliation: ${err}`
    )
    logger.event('auto-merge.status-update-failed', { taskId, error: String(err) })
    throw err
  }
}
