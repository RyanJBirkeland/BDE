/**
 * Review orchestration service — thin facade over policy + executor layers.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createLogger } from '../logger'
import { classifyReviewAction } from './review-action-policy'
import { executeReviewAction } from './review-action-executor'
import { createPullRequest } from './review-pr-service'
import { cleanupWorktree } from './review-merge-service'
import { getTask, updateTask, notifySprintMutation } from './sprint-service'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import { getSettingJson } from '../settings'
import { createSprintTaskRepository } from '../data/sprint-task-repository'
import type {
  MergeLocallyInput,
  MergeLocallyResult,
  CreatePrInput,
  CreatePrResult,
  RequestRevisionInput,
  RequestRevisionResult,
  DiscardInput,
  DiscardResult,
  ShipItInput,
  ShipItResult,
  RebaseInput,
  RebaseResult
} from './review-orchestration-types'
import type { SprintTask } from '../../shared/types/task-types'

export type {
  MergeLocallyInput,
  MergeLocallyResult,
  CreatePrInput,
  CreatePrResult,
  RequestRevisionInput,
  RequestRevisionResult,
  DiscardInput,
  DiscardResult,
  ShipItInput,
  ShipItResult,
  RebaseInput,
  RebaseResult
}

const execFileAsync = promisify(execFile)
const logger = createLogger('review-orchestration')
const repo = createSprintTaskRepository()

function getRepoConfig(name: string): { name: string; localPath: string } | null {
  const repos = getSettingJson<Array<{ name: string; localPath: string }>>('repos')
  return repos?.find((r) => r.name.toLowerCase() === name.toLowerCase()) ?? null
}

async function runPlan(
  taskId: string,
  input: Parameters<typeof classifyReviewAction>[0],
  env: NodeJS.ProcessEnv,
  onTerminal: (taskId: string, status: string) => void | Promise<void>
): Promise<ReturnType<typeof executeReviewAction>> {
  return executeReviewAction(classifyReviewAction(input), taskId, {
    repo,
    broadcast: (event: string, payload: unknown) => {
      if (event === 'sprint:mutation' && typeof payload === 'object' && payload !== null) {
        const { type, task } = payload as { type: 'created' | 'updated' | 'deleted'; task: SprintTask }
        notifySprintMutation(type, task)
      }
    },
    onStatusTerminal: onTerminal,
    env,
    logger
  })
}

export async function mergeLocally(i: MergeLocallyInput): Promise<MergeLocallyResult> {
  const task = getTask(i.taskId)
  if (!task) throw new Error(`Task ${i.taskId} not found`)
  try {
    await runPlan(
      i.taskId,
      {
        action: 'mergeLocally',
        taskId: i.taskId,
        task,
        repoConfig: getRepoConfig(task.repo),
        strategy: i.strategy
      },
      i.env,
      i.onStatusTerminal
    )
    return { success: true }
  } catch (err: unknown) {
    const e = err as Error & { conflicts?: string[] }
    return { success: false, error: getErrorMessage(err), conflicts: e.conflicts }
  }
}

export async function createPr(i: CreatePrInput): Promise<CreatePrResult> {
  const task = getTask(i.taskId)
  if (!task) throw new Error(`Task ${i.taskId} not found`)
  if (!task.worktree_path) throw new Error(`Task ${i.taskId} has no worktree path`)
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: task.worktree_path,
      env: i.env
    })
    const branch = stdout.trim()
    const pr = await createPullRequest({
      worktreePath: task.worktree_path,
      branch,
      title: i.title,
      body: i.body,
      env: i.env
    })
    if (!pr.success || !pr.prUrl) {
      return { success: false, error: pr.error || 'PR creation failed' }
    }
    updateTask(i.taskId, { pr_url: pr.prUrl, pr_number: pr.prNumber ?? null, pr_status: 'open' })
    const cfg = getRepoConfig(task.repo)
    if (cfg) await cleanupWorktree(task.worktree_path, branch, cfg.localPath, i.env)
    const updated = updateTask(i.taskId, {
      status: 'done',
      completed_at: nowIso(),
      worktree_path: null
    })
    if (updated) notifySprintMutation('updated', updated)
    i.onStatusTerminal(i.taskId, 'done')
    return { success: true, prUrl: pr.prUrl }
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err) }
  }
}

export async function requestRevision(i: RequestRevisionInput): Promise<RequestRevisionResult> {
  const task = getTask(i.taskId)
  if (!task) throw new Error(`Task ${i.taskId} not found`)
  await runPlan(
    i.taskId,
    {
      action: 'requestRevision',
      taskId: i.taskId,
      task,
      repoConfig: null,
      feedback: i.feedback,
      revisionMode: i.mode
    },
    process.env,
    () => {}
  )
  return { success: true }
}

export async function discard(i: DiscardInput): Promise<DiscardResult> {
  const task = getTask(i.taskId)
  if (!task) throw new Error(`Task ${i.taskId} not found`)
  await runPlan(
    i.taskId,
    { action: 'discard', taskId: i.taskId, task, repoConfig: getRepoConfig(task.repo) },
    i.env,
    i.onStatusTerminal
  )
  return { success: true }
}

export async function shipIt(i: ShipItInput): Promise<ShipItResult> {
  const task = getTask(i.taskId)
  if (!task) throw new Error(`Task ${i.taskId} not found`)
  try {
    await runPlan(
      i.taskId,
      {
        action: 'shipIt',
        taskId: i.taskId,
        task,
        repoConfig: getRepoConfig(task.repo),
        strategy: i.strategy
      },
      i.env,
      i.onStatusTerminal
    )
    return { success: true, pushed: true }
  } catch (err: unknown) {
    const e = err as Error & { conflicts?: string[] }
    return { success: false, error: getErrorMessage(err), conflicts: e.conflicts }
  }
}

export async function rebase(i: RebaseInput): Promise<RebaseResult> {
  const task = getTask(i.taskId)
  if (!task) throw new Error(`Task ${i.taskId} not found`)
  try {
    const state = await executeReviewAction(
      classifyReviewAction({ action: 'rebase', taskId: i.taskId, task, repoConfig: null }),
      i.taskId,
      {
        repo,
        broadcast: (event: string, payload: unknown) => {
          if (event === 'sprint:mutation' && typeof payload === 'object' && payload !== null) {
            const { type, task } = payload as { type: 'created' | 'updated' | 'deleted'; task: SprintTask }
            notifySprintMutation(type, task)
          }
        },
        onStatusTerminal: () => {},
        env: i.env,
        logger
      }
    )
    if (state.baseSha) {
      const u = updateTask(i.taskId, { rebase_base_sha: state.baseSha, rebased_at: nowIso() })
      if (u) notifySprintMutation('updated', u)
    }
    return { success: true, baseSha: state.baseSha }
  } catch (err: unknown) {
    const e = err as Error & { conflicts?: string[] }
    return { success: false, error: getErrorMessage(err), conflicts: e.conflicts }
  }
}
