/**
 * Review orchestration service — thin facade over policy + executor layers.
 *
 * Entry points (`mergeLocally`, `createPr`, etc.) each build a `ReviewGitOp`
 * via `buildReviewGitOpPlan`, then hand it to `executeReviewGitOp`. The
 * exhaustive switch inside `executeReviewGitOp` ensures a compile error when a
 * new `ReviewGitOp` variant is added without a corresponding execution path.
 */
import { execFileAsync } from '../lib/async-utils'
import { createLogger } from '../logger'
import { classifyReviewAction } from './review-action-policy'
import { executeReviewAction } from './review-action-executor'
import { createPullRequest } from './review-pr-service'
import { cleanupWorktree, parseNumstat } from './review-merge-service'
import type { ReviewGitOp } from './review-gitop-types'
import { assertNeverGitOp } from './review-gitop-types'

export { parseNumstat }
import { getTask, updateTask, notifySprintMutation } from './sprint-service'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { getRepoConfig } from '../paths'

/**
 * Injected repository instance — set once at startup by the composition root
 * via `setReviewOrchestrationRepo(repo)`. All call sites in this module use
 * `getRepo()` so they always read the current instance.
 */
let _repo: ISprintTaskRepository | null = null

export function setReviewOrchestrationRepo(repo: ISprintTaskRepository): void {
  _repo = repo
}

function getRepo(): ISprintTaskRepository {
  if (!_repo) throw new Error('[review-orchestration] Repository not initialised — call setReviewOrchestrationRepo(repo) before use')
  return _repo
}
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
import type { TaskStatus } from '../../shared/task-state-machine'
import type { TaskStateService } from './task-state-service'

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

const logger = createLogger('review-orchestration')

// ============================================================================
// ReviewGitOp builder + exhaustive executor
// ============================================================================

interface ExecutionContext {
  taskId: string
  env: NodeJS.ProcessEnv
  onStatusTerminal: (taskId: string, status: TaskStatus) => void | Promise<void>
}

/**
 * Build the typed `ReviewGitOp` plan that describes which action to execute.
 * Pure — no I/O. The returned value drives `executeReviewGitOp`.
 */
export function buildReviewGitOpPlan(
  input:
    | { action: 'mergeLocally'; strategy: 'merge' | 'squash' | 'rebase' }
    | { action: 'createPr'; title: string; body: string }
    | { action: 'requestRevision'; feedback: string; mode: 'resume' | 'fresh' }
    | { action: 'discard' }
    | { action: 'shipIt'; strategy: 'merge' | 'squash' | 'rebase' }
    | { action: 'rebase' }
): ReviewGitOp {
  switch (input.action) {
    case 'mergeLocally':
      return { type: 'mergeLocally', strategy: input.strategy }
    case 'createPr':
      return { type: 'createPr', title: input.title, body: input.body }
    case 'requestRevision':
      return { type: 'requestRevision', feedback: input.feedback, mode: input.mode }
    case 'discard':
      return { type: 'discard' }
    case 'shipIt':
      return { type: 'shipIt', strategy: input.strategy }
    case 'rebase':
      return { type: 'rebase' }
    default:
      return assertNeverGitOp(input as never)
  }
}

/**
 * Execute a typed `ReviewGitOp` plan. The exhaustive switch guarantees a
 * compile error when a new variant is added to `ReviewGitOp` without a
 * corresponding execution path.
 */
async function executeReviewGitOp(
  op: ReviewGitOp,
  ctx: ExecutionContext
): Promise<ReturnType<typeof executeReviewAction> | { prUrl?: string }> {
  const task = getTask(ctx.taskId)
  if (!task) throw new Error(`Task ${ctx.taskId} not found`)

  switch (op.type) {
    case 'mergeLocally':
      return runActionPlan(
        ctx.taskId,
        {
          action: 'mergeLocally',
          taskId: ctx.taskId,
          task,
          repoConfig: getRepoConfig(task.repo),
          strategy: op.strategy
        },
        ctx.env,
        ctx.onStatusTerminal
      )

    case 'createPr':
      return executePrCreation(ctx.taskId, task, op.title, op.body, ctx.env)

    case 'requestRevision':
      return runActionPlan(
        ctx.taskId,
        {
          action: 'requestRevision',
          taskId: ctx.taskId,
          task,
          repoConfig: null,
          feedback: op.feedback,
          revisionMode: op.mode
        },
        process.env,
        () => {}
      )

    case 'discard':
      return runActionPlan(
        ctx.taskId,
        { action: 'discard', taskId: ctx.taskId, task, repoConfig: getRepoConfig(task.repo) },
        ctx.env,
        ctx.onStatusTerminal
      )

    case 'shipIt':
      return runActionPlan(
        ctx.taskId,
        {
          action: 'shipIt',
          taskId: ctx.taskId,
          task,
          repoConfig: getRepoConfig(task.repo),
          strategy: op.strategy
        },
        ctx.env,
        ctx.onStatusTerminal
      )

    case 'rebase':
      return executeRebaseAction(ctx.taskId, task, ctx.env)

    default:
      return assertNeverGitOp(op)
  }
}

// ============================================================================
// Internal helpers
// ============================================================================

function makeBroadcast(): (event: string, payload: unknown) => void {
  return (event, payload) => {
    if (event !== 'sprint:mutation' || typeof payload !== 'object' || payload === null) return
    const { type, task } = payload as { type: 'created' | 'updated' | 'deleted'; task: SprintTask }
    notifySprintMutation(type, task)
  }
}

async function runActionPlan(
  taskId: string,
  input: Parameters<typeof classifyReviewAction>[0],
  env: NodeJS.ProcessEnv,
  onTerminal: (taskId: string, status: TaskStatus) => void | Promise<void>
): Promise<ReturnType<typeof executeReviewAction>> {
  return executeReviewAction(classifyReviewAction(input), taskId, {
    repo: getRepo(),
    broadcast: makeBroadcast(),
    onStatusTerminal: onTerminal,
    env,
    logger
  })
}

async function executePrCreation(
  taskId: string,
  task: Pick<SprintTask, 'id' | 'title' | 'repo' | 'worktree_path' | 'spec' | 'notes' | 'agent_run_id'>,
  title: string,
  body: string,
  env: NodeJS.ProcessEnv
): Promise<{ prUrl: string }> {
  if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)

  const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: task.worktree_path,
    env
  })
  const branch = stdout.trim()

  const pr = await createPullRequest({
    worktreePath: task.worktree_path,
    branch,
    title,
    body,
    env
  })
  if (!pr.success || !pr.prUrl) {
    throw new Error(pr.error || 'PR creation failed')
  }

  await updateTask(taskId, { pr_url: pr.prUrl, pr_number: pr.prNumber ?? null, pr_status: 'open' })

  const cfg = getRepoConfig(task.repo)
  if (cfg) await cleanupWorktree(task.worktree_path, branch, cfg.localPath, env)

  // Keep the task in `review` — the sprint PR poller watches pr_status='open' tasks
  // and marks them done when GitHub reports the PR as merged. Marking done here would
  // transition before the merge event and bypass the poller's cancelled-on-close path.
  const updated = await updateTask(taskId, { worktree_path: null })
  if (updated) notifySprintMutation('updated', updated)

  return { prUrl: pr.prUrl }
}

async function executeRebaseAction(
  taskId: string,
  task: Pick<SprintTask, 'id' | 'title' | 'repo' | 'worktree_path' | 'spec' | 'notes' | 'agent_run_id'>,
  env: NodeJS.ProcessEnv
): Promise<ReturnType<typeof executeReviewAction>> {
  const state = await executeReviewAction(
    classifyReviewAction({ action: 'rebase', taskId, task, repoConfig: null }),
    taskId,
    {
      repo: getRepo(),
      broadcast: makeBroadcast(),
      onStatusTerminal: () => {},
      env,
      logger
    }
  )
  if (state.baseSha) {
    const u = await updateTask(taskId, { rebase_base_sha: state.baseSha, rebased_at: nowIso() })
    if (u) notifySprintMutation('updated', u)
  }
  return state
}

// ============================================================================
// Public API
// ============================================================================

export async function mergeLocally(i: MergeLocallyInput): Promise<MergeLocallyResult> {
  const op = buildReviewGitOpPlan({ action: 'mergeLocally', strategy: i.strategy })
  try {
    await executeReviewGitOp(op, { taskId: i.taskId, env: i.env, onStatusTerminal: i.onStatusTerminal })
    return { success: true }
  } catch (err: unknown) {
    const e = err as Error & { conflicts?: string[] }
    return { success: false, error: getErrorMessage(err), conflicts: e.conflicts }
  }
}

export async function createPr(i: CreatePrInput): Promise<CreatePrResult> {
  const op = buildReviewGitOpPlan({ action: 'createPr', title: i.title, body: i.body })
  try {
    const result = await executeReviewGitOp(op, {
      taskId: i.taskId,
      env: i.env,
      onStatusTerminal: i.onStatusTerminal
    })
    const prUrl = (result as { prUrl?: string }).prUrl
    return { success: true, prUrl: prUrl ?? '' }
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err) }
  }
}

export async function requestRevision(i: RequestRevisionInput): Promise<RequestRevisionResult> {
  const op = buildReviewGitOpPlan({ action: 'requestRevision', feedback: i.feedback, mode: i.mode })
  await executeReviewGitOp(op, { taskId: i.taskId, env: process.env, onStatusTerminal: () => {} })
  return { success: true }
}

export async function discard(i: DiscardInput): Promise<DiscardResult> {
  const op = buildReviewGitOpPlan({ action: 'discard' })
  await executeReviewGitOp(op, { taskId: i.taskId, env: i.env, onStatusTerminal: i.onStatusTerminal })
  return { success: true }
}

export async function shipIt(i: ShipItInput): Promise<ShipItResult> {
  const op = buildReviewGitOpPlan({ action: 'shipIt', strategy: i.strategy })
  try {
    await executeReviewGitOp(op, { taskId: i.taskId, env: i.env, onStatusTerminal: i.onStatusTerminal })
    return { success: true, pushed: true }
  } catch (err: unknown) {
    const e = err as Error & { conflicts?: string[] }
    return { success: false, error: getErrorMessage(err), conflicts: e.conflicts }
  }
}

export async function rebase(i: RebaseInput): Promise<RebaseResult> {
  const op = buildReviewGitOpPlan({ action: 'rebase' })
  try {
    const state = await executeReviewGitOp(op, {
      taskId: i.taskId,
      env: i.env,
      onStatusTerminal: () => {}
    })
    return { success: true, baseSha: (state as { baseSha?: string }).baseSha }
  } catch (err: unknown) {
    const e = err as Error & { conflicts?: string[] }
    return { success: false, error: getErrorMessage(err), conflicts: e.conflicts }
  }
}

export type FreshnessResult =
  | { status: 'fresh'; commitsBehind: 0 }
  | { status: 'stale'; commitsBehind: number }
  | { status: 'unknown' }

export async function checkReviewFreshness(
  taskId: string,
  env: NodeJS.ProcessEnv
): Promise<FreshnessResult> {
  const task = getTask(taskId)
  if (!task) return { status: 'unknown' }
  if (!task.rebase_base_sha) return { status: 'unknown' }

  try {
    const repoConfig = getRepoConfig(task.repo)
    if (!repoConfig) return { status: 'unknown' }

    await execFileAsync('git', ['fetch', 'origin', 'main'], { cwd: repoConfig.localPath, env })

    const { stdout: currentShaOut } = await execFileAsync(
      'git',
      ['rev-parse', 'origin/main'],
      { cwd: repoConfig.localPath, env }
    )
    const currentSha = currentShaOut.trim()

    if (currentSha === task.rebase_base_sha) {
      return { status: 'fresh', commitsBehind: 0 }
    }

    const { stdout: countOut } = await execFileAsync(
      'git',
      ['rev-list', '--count', `${task.rebase_base_sha}..origin/main`],
      { cwd: repoConfig.localPath, env }
    )
    return { status: 'stale', commitsBehind: parseInt(countOut.trim(), 10) }
  } catch (err: unknown) {
    logger.warn(`[checkReviewFreshness] Error for task ${taskId}: ${err}`)
    return { status: 'unknown' }
  }
}

export async function markShippedOutsideBde(
  taskId: string,
  deps: { taskStateService: TaskStateService }
): Promise<{ success: true }> {
  const task = getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (task.status !== 'review') {
    throw new Error(`Task ${taskId} is not in review status (status: ${task.status})`)
  }

  logger.info(`markShippedOutsideBde task=${taskId}`)
  await deps.taskStateService.transition(taskId, 'done', {
    fields: { completed_at: nowIso() },
    caller: 'review:markShippedOutsideBde'
  })
  return { success: true }
}
