/**
 * Auto-merge coordinator — evaluates and executes automatic merges after agent completion.
 *
 * When a task transitions to 'review', auto-merge rules are checked. If a rule matches,
 * the agent's branch is squash-merged into main without human intervention.
 *
 * Failures are non-fatal: the task stays in 'review' for human action.
 */
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import { nowIso } from '../../shared/time'
import { evaluateAutoMergePolicy } from './auto-merge-policy'
import { executeSquashMerge } from '../lib/git-operations'

export interface AutoMergeContext {
  taskId: string
  title: string
  branch: string
  worktreePath: string
  repo: IAgentTaskRepository
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
}

/**
 * Get repository config for a task from settings.
 * Returns null if task or repo config not found.
 */
async function getRepoConfig(
  taskId: string,
  repo: IAgentTaskRepository,
  logger: Logger
): Promise<{ name: string; localPath: string } | null> {
  const task = repo.getTask(taskId)
  if (!task) {
    logger.error(`[completion] Task ${taskId} not found`)
    return null
  }

  const { getSettingJson } = await import('../settings')
  const repos = getSettingJson<Array<{ name: string; localPath: string }>>('repos')
  const repoConfig = repos?.find((r) => r.name === task.repo)
  if (!repoConfig) {
    logger.error(`[completion] Repo "${task.repo}" not found in settings`)
    return null
  }

  return repoConfig
}

export async function evaluateAutoMerge(opts: AutoMergeContext): Promise<void> {
  const { taskId, title, branch, worktreePath, repo, logger, onTaskTerminal } = opts
  const { getSettingJson } = await import('../settings')
  const rules = getSettingJson<import('../../shared/types/task-types').AutoReviewRule[]>('autoReview.rules')

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

    const repoConfig = await getRepoConfig(taskId, repo, logger)
    if (!repoConfig) {
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
      const reviewTask = repo.getTask(taskId)
      repo.updateTask(taskId, {
        status: 'done',
        completed_at: nowIso(),
        worktree_path: null,
        ...(reviewTask?.duration_ms !== undefined ? { duration_ms: reviewTask.duration_ms } : {})
      })
      logger.info(`[completion] Task ${taskId} auto-merged successfully`)
      await onTaskTerminal(taskId, 'done')
    } else if (mergeResult === 'dirty-main') {
      logger.warn(
        `[completion] Task ${taskId} auto-merge skipped: main repo has uncommitted changes — task remains in review`
      )
    } else {
      logger.error(
        `[completion] Task ${taskId} auto-merge failed — task remains in review`
      )
    }
  } catch (err) {
    // Auto-merge is best-effort: a failure here leaves the task in 'review' for human action,
    // which is always the safe fallback. Do not re-throw — the task state is already consistent.
    logger.error(`[completion] Auto-merge check failed for task ${taskId}: ${err}`)
  }
}
