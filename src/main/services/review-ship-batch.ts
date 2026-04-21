/**
 * Review ship-batch service — ships multiple review tasks with a single push.
 *
 * For each task in order: rebase onto origin/main, squash-merge the agent
 * branch onto local main, clean up the worktree. After ALL tasks merge
 * successfully, issue a SINGLE `git push origin HEAD`. Aborts on the first
 * per-task failure — any tasks merged before the failure remain on local
 * main (un-pushed) so the caller can retry or roll back manually.
 *
 * This is the shared cherry-pick-equivalent logic for the "Ship N Selected"
 * batch button in Code Review Station. The per-task merge reuses the same
 * `executeReviewAction` pipeline as single-task shipIt — only the push is
 * deferred and batched.
 */
import { execFileAsync } from '../lib/async-utils'
import { createLogger } from '../logger'
import { classifyReviewAction } from './review-action-policy'
import type { GitOpDescriptor } from './review-action-policy'
import { executeReviewAction } from './review-action-executor'
import { getTask, notifySprintMutation } from './sprint-service'
import { getErrorMessage } from '../../shared/errors'
import { getSettingJson } from '../settings'
import { createSprintTaskRepository } from '../data/sprint-task-repository'
import type { ShipBatchInput, ShipBatchResult } from './review-orchestration-types'
import type { SprintTask } from '../../shared/types/task-types'

const logger = createLogger('review-ship-batch')
const repo = createSprintTaskRepository()

interface RepoConfig {
  name: string
  localPath: string
}

function getRepoConfig(repoName: string): RepoConfig | null {
  const repos = getSettingJson<RepoConfig[]>('repos')
  return repos?.find((r) => r.name.toLowerCase() === repoName.toLowerCase()) ?? null
}

/**
 * Builds a shipIt plan with the `push` operation stripped so the caller can
 * batch pushes. Single-task shipIt logic stays unchanged — this is a deferred
 * variant that preserves every other op (merge, dedup, cleanup, patch).
 */
function buildShipPlanWithoutPush(
  task: Pick<
    SprintTask,
    'id' | 'title' | 'repo' | 'worktree_path' | 'spec' | 'notes' | 'agent_run_id'
  >,
  repoConfig: RepoConfig,
  strategy: 'merge' | 'squash' | 'rebase'
): ReturnType<typeof classifyReviewAction> {
  const plan = classifyReviewAction({
    action: 'shipIt',
    taskId: task.id,
    task,
    repoConfig,
    strategy
  })
  return {
    ...plan,
    gitOps: plan.gitOps.filter((op: GitOpDescriptor) => op.type !== 'push')
  }
}

function broadcastMutation(event: string, payload: unknown): void {
  if (event !== 'sprint:mutation' || typeof payload !== 'object' || payload === null) return
  const { type, task } = payload as { type: 'created' | 'updated' | 'deleted'; task: SprintTask }
  notifySprintMutation(type, task)
}

async function pushLocalMain(repoPath: string, env: NodeJS.ProcessEnv): Promise<void> {
  logger.info('[ship-batch] Pushing local main to origin (batch final step)')
  await execFileAsync('git', ['push', 'origin', 'HEAD'], { cwd: repoPath, env })
}

function requireCommonRepoConfig(tasks: Array<Pick<SprintTask, 'id' | 'repo'>>): RepoConfig {
  const first = tasks[0]
  if (!first) throw new Error('Batch ship requires at least one task.')
  const repoConfig = getRepoConfig(first.repo)
  if (!repoConfig) {
    throw new Error(`Repo "${first.repo}" not found in settings`)
  }
  const mismatched = tasks.find((t) => t.repo.toLowerCase() !== first.repo.toLowerCase())
  if (mismatched) {
    throw new Error(
      `Batch ship requires all tasks to share one repo. Expected "${first.repo}", got "${mismatched.repo}" on task ${mismatched.id}.`
    )
  }
  return repoConfig
}

function loadTasksOrThrow(
  taskIds: string[]
): Array<
  Pick<SprintTask, 'id' | 'title' | 'repo' | 'worktree_path' | 'spec' | 'notes' | 'agent_run_id'>
> {
  if (taskIds.length === 0) {
    throw new Error('shipBatch requires at least one taskId')
  }
  return taskIds.map((id) => {
    const task = getTask(id)
    if (!task) throw new Error(`Task ${id} not found`)
    return task
  })
}

export async function shipBatch(input: ShipBatchInput): Promise<ShipBatchResult> {
  const { taskIds, strategy, env, onStatusTerminal } = input
  const shippedTaskIds: string[] = []

  let tasks: Array<
    Pick<SprintTask, 'id' | 'title' | 'repo' | 'worktree_path' | 'spec' | 'notes' | 'agent_run_id'>
  >
  let repoConfig: RepoConfig
  try {
    tasks = loadTasksOrThrow(taskIds)
    repoConfig = requireCommonRepoConfig(tasks)
  } catch (err: unknown) {
    return {
      success: false,
      error: getErrorMessage(err),
      failedTaskId: null,
      shippedTaskIds
    }
  }

  for (const task of tasks) {
    try {
      const plan = buildShipPlanWithoutPush(task, repoConfig, strategy)
      await executeReviewAction(plan, task.id, {
        repo,
        broadcast: broadcastMutation,
        onStatusTerminal,
        env,
        logger
      })
      shippedTaskIds.push(task.id)
    } catch (err: unknown) {
      const e = err as Error & { conflicts?: string[] }
      return {
        success: false,
        error: getErrorMessage(err),
        failedTaskId: task.id,
        shippedTaskIds,
        conflicts: e.conflicts
      }
    }
  }

  try {
    await pushLocalMain(repoConfig.localPath, env)
  } catch (err: unknown) {
    return {
      success: false,
      error: `Batch push failed: ${getErrorMessage(err)}. ${shippedTaskIds.length} merged commit(s) remain on local main — retry the push manually.`,
      failedTaskId: null,
      shippedTaskIds
    }
  }

  return { success: true, pushed: true, shippedTaskIds }
}
