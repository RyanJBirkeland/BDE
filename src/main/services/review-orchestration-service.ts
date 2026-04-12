/**
 * Review orchestration service — coordinates review actions across services.
 *
 * This is the business logic layer that orchestrates review actions (shipIt,
 * mergeLocally, createPr, etc.) by coordinating between lower-level services:
 * - review-merge-service (git merges, cleanup)
 * - review-pr-service (PR creation)
 * - sprint-service (task CRUD)
 * - task-terminal-service (dependency resolution)
 *
 * IPC handlers in review.ts should be thin wrappers that call these functions.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '../logger'
import {
  mergeAgentBranch,
  cleanupWorktree,
  executeMergeStrategy
} from './review-merge-service'
import { createPullRequest } from './review-pr-service'
import { getTask as _getTask, updateTask as _updateTask } from './sprint-service'
import { runPostMergeDedup } from './post-merge-dedup'
import { rebaseOntoMain } from '../agent-manager/git-operations'
import { BDE_TASK_MEMORY_DIR } from '../paths'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import { getSettingJson } from '../settings'
import { notifySprintMutation } from './sprint-service'

const execFileAsync = promisify(execFile)
const logger = createLogger('review-orchestration')

interface RepoConfig {
  name: string
  localPath: string
  githubOwner?: string
  githubRepo?: string
}

function getRepoConfig(repoName: string): RepoConfig | null {
  const repos = getSettingJson<RepoConfig[]>('repos')
  const target = repoName.toLowerCase()
  return repos?.find((r) => r.name.toLowerCase() === target) ?? null
}

// ============================================================================
// Result Types
// ============================================================================

export interface MergeLocallyResult {
  success: boolean
  error?: string
  conflicts?: string[]
}

export interface CreatePrResult {
  success: boolean
  prUrl?: string
  error?: string
}

export interface RequestRevisionResult {
  success: boolean
}

export interface DiscardResult {
  success: boolean
}

/**
 * Ship It can only end in two ways:
 * - `{ success: true, pushed: true }` — merged, pushed, worktree cleaned,
 *   task marked done. `pushed: false` is impossible by construction: if the
 *   push fails, the whole operation returns `{ success: false, error }`
 *   with the squash commit still on local main, worktree preserved, and
 *   task still in review for retry.
 * - `{ success: false, error, conflicts? }` — any failure in fetch/FF/
 *   rebase/merge/push. Task state is left unchanged.
 */
export type ShipItResult =
  | { success: true; pushed: true }
  | { success: false; error: string; conflicts?: string[] }

export interface RebaseResult {
  success: boolean
  baseSha?: string
  error?: string
  conflicts?: string[]
}

// ============================================================================
// Input Types
// ============================================================================

export interface MergeLocallyInput {
  taskId: string
  strategy: 'merge' | 'squash' | 'rebase'
  env: NodeJS.ProcessEnv
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

export interface CreatePrInput {
  taskId: string
  title: string
  body: string
  env: NodeJS.ProcessEnv
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

export interface RequestRevisionInput {
  taskId: string
  feedback: string
  mode: 'resume' | 'fresh'
}

export interface DiscardInput {
  taskId: string
  env: NodeJS.ProcessEnv
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

export interface ShipItInput {
  taskId: string
  strategy: 'merge' | 'squash' | 'rebase'
  env: NodeJS.ProcessEnv
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
}

export interface RebaseInput {
  taskId: string
  env: NodeJS.ProcessEnv
}

// ============================================================================
// Orchestration Functions
// ============================================================================

/**
 * Merge agent branch into current branch (no push), cleanup worktree, mark done.
 */
export async function mergeLocally(input: MergeLocallyInput): Promise<MergeLocallyResult> {
  const { taskId, strategy, env, onStatusTerminal } = input

  const task = _getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)

  // Get branch name from the worktree
  const { stdout: branchName } = await execFileAsync(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: task.worktree_path, env }
  )
  const branch = branchName.trim()

  // Resolve repo local path
  const repoConfig = getRepoConfig(task.repo)
  if (!repoConfig) throw new Error(`Repo "${task.repo}" not found in settings`)
  const repoPath = repoConfig.localPath

  // Execute merge via service
  const result = await mergeAgentBranch({
    worktreePath: task.worktree_path,
    branch,
    repoPath,
    strategy,
    taskId,
    taskTitle: task.title,
    env
  })

  if (!result.success) {
    return { success: false, error: result.error, conflicts: result.conflicts }
  }

  // Post-merge CSS dedup warnings
  try {
    const dedupReport = await runPostMergeDedup(repoPath)
    if (dedupReport?.warnings.length) {
      const existing = _getTask(taskId)
      const warnText = `\n\n## CSS Near-Duplicate Warnings\n${dedupReport.warnings.join('\n')}`
      _updateTask(taskId, { notes: (existing?.notes || '') + warnText })
    }
  } catch (err) {
    logger.warn(`[mergeLocally] Post-merge dedup failed (non-fatal): ${err}`)
  }

  // Clean up worktree + branch
  await cleanupWorktree(task.worktree_path, branch, repoPath, env)

  // Mark task done via terminal service
  const updated = _updateTask(taskId, {
    status: 'done',
    completed_at: nowIso(),
    worktree_path: null
  })
  if (updated) notifySprintMutation('updated', updated)
  onStatusTerminal(taskId, 'done')

  return { success: true }
}

/**
 * Push branch and create GitHub PR, cleanup worktree, mark done.
 */
export async function createPr(input: CreatePrInput): Promise<CreatePrResult> {
  const { taskId, title, body, env, onStatusTerminal } = input

  const task = _getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)

  // Get branch name from the worktree
  const { stdout: branchOut } = await execFileAsync(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: task.worktree_path, env }
  )
  const branch = branchOut.trim()

  // Push and create PR (or get existing)
  const result = await createPullRequest({
    worktreePath: task.worktree_path,
    branch,
    title,
    body,
    env
  })

  if (!result.success || !result.prUrl) {
    return { success: false, error: result.error || 'PR creation failed' }
  }

  // Update task with PR info
  _updateTask(taskId, {
    pr_url: result.prUrl,
    pr_number: result.prNumber ?? null,
    pr_status: 'open'
  })

  // Clean up worktree (branch stays for the PR)
  const repoConfig = getRepoConfig(task.repo)
  if (repoConfig) {
    await cleanupWorktree(task.worktree_path, branch, repoConfig.localPath, env)
  }

  // Mark task done via terminal service
  const updated = _updateTask(taskId, {
    status: 'done',
    completed_at: nowIso(),
    worktree_path: null
  })
  if (updated) notifySprintMutation('updated', updated)
  onStatusTerminal(taskId, 'done')

  return { success: true, prUrl: result.prUrl }
}

/**
 * Send task back to queue with revision feedback appended to spec.
 *
 * INTENTIONAL TRANSITION: review → queued
 * This is the correct path for requesting revisions. The task returns to the
 * queue so the agent manager can pick it up and re-execute with the feedback
 * appended to the spec. The 'review' status is not a valid transition target
 * (it's a UI-only partition, not a DB status). Tasks awaiting review have
 * status='active' or 'done' with pr_status='open'.
 */
export async function requestRevision(
  input: RequestRevisionInput
): Promise<RequestRevisionResult> {
  const { taskId, feedback, mode } = input

  const task = _getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  const revisionNotes = `[Revision requested]: ${feedback}`
  const patch: Record<string, unknown> = {
    status: 'queued',
    claimed_by: null,
    notes: revisionNotes,
    started_at: null,
    completed_at: null,
    fast_fail_count: 0,
    needs_review: false,
    // Append feedback to spec so the agent sees it
    spec: task.spec ? `${task.spec}\n\n## Revision Feedback\n\n${feedback}` : feedback
  }

  // In fresh mode, clear the agent_run_id to start a new session
  if (mode === 'fresh') {
    patch.agent_run_id = null
  }

  const updated = _updateTask(taskId, patch)
  if (updated) notifySprintMutation('updated', updated)

  return { success: true }
}

/**
 * Clean up worktree + branch, mark task cancelled, trigger dependency resolution.
 */
export async function discard(input: DiscardInput): Promise<DiscardResult> {
  const { taskId, env, onStatusTerminal } = input

  const task = _getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  // Clean up worktree if it exists
  if (task.worktree_path) {
    const repoConfig = getRepoConfig(task.repo)
    if (repoConfig) {
      // Read branch name BEFORE removing worktree
      let branch: string | null = null
      try {
        const { stdout: branchOut } = await execFileAsync(
          'git',
          ['rev-parse', '--abbrev-ref', 'HEAD'],
          { cwd: task.worktree_path, env }
        )
        branch = branchOut.trim()
      } catch {
        /* best-effort — worktree may not exist */
      }

      if (branch && branch !== 'HEAD') {
        await cleanupWorktree(task.worktree_path, branch, repoConfig.localPath, env)
      }
    }
  }

  // Clean up task scratchpad
  try {
    rmSync(join(BDE_TASK_MEMORY_DIR, taskId), { recursive: true, force: true })
  } catch {
    /* best-effort */
  }

  // Mark task cancelled via terminal service
  const updated = _updateTask(taskId, {
    status: 'cancelled',
    completed_at: nowIso(),
    worktree_path: null
  })
  if (updated) notifySprintMutation('updated', updated)
  onStatusTerminal(taskId, 'cancelled')

  return { success: true }
}

/**
 * Ship it: merge + push + done in one action.
 *
 * Flow:
 * 1. Verify main repo is on `main` with clean working tree
 * 2. Fetch origin/main and fast-forward local main
 * 3. Rebase agent branch onto origin/main
 * 4. Execute merge strategy (merge/squash/rebase)
 * 5. Run post-merge CSS dedup
 * 6. Push to origin
 * 7. Cleanup worktree + branch
 * 8. Mark task done
 */
export async function shipIt(input: ShipItInput): Promise<ShipItResult> {
  const { taskId, strategy, env, onStatusTerminal } = input

  const task = _getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)

  // Get branch name from the worktree
  const { stdout: branchName } = await execFileAsync(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: task.worktree_path, env }
  )
  const branch = branchName.trim()

  // Resolve repo local path
  const repoConfig = getRepoConfig(task.repo)
  if (!repoConfig) throw new Error(`Repo "${task.repo}" not found in settings`)
  const repoPath = repoConfig.localPath

  // Verify clean working tree
  const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd: repoPath,
    env
  })
  if (statusOut.trim()) {
    return {
      success: false,
      error: 'Working tree has uncommitted changes. Commit or stash first.'
    }
  }

  // Verify main checkout is on `main` branch
  const { stdout: currentBranchOut } = await execFileAsync(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: repoPath, env }
  )
  const currentBranch = currentBranchOut.trim()
  if (currentBranch !== 'main') {
    return {
      success: false,
      error: `Main repo checkout is on branch "${currentBranch}", not "main". Switch to main before shipping.`
    }
  }

  // Fetch origin/main and fast-forward local main
  try {
    logger.info(`[shipIt] Fetching origin/main for task ${taskId}`)
    await execFileAsync('git', ['fetch', 'origin', 'main'], { cwd: repoPath, env })
    logger.info(`[shipIt] Fast-forwarding local main to origin/main`)
    await execFileAsync('git', ['merge', '--ff-only', 'origin/main'], { cwd: repoPath, env })
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err)
    logger.error(`[shipIt] Fetch/FF failed for task ${taskId}: ${errMsg}`)
    return {
      success: false,
      error: `Failed to sync local main with origin: ${errMsg}`
    }
  }

  // Rebase agent branch onto origin/main
  const rebaseResult = await rebaseOntoMain(task.worktree_path, env, logger)
  if (!rebaseResult.success) {
    return { success: false, error: `Rebase failed: ${rebaseResult.notes}` }
  }

  // Execute merge strategy
  const mergeResult = await executeMergeStrategy(
    branch,
    repoPath,
    strategy,
    taskId,
    task.title,
    env
  )
  if (!mergeResult.success) {
    return {
      success: false,
      error: mergeResult.error ?? 'Unknown merge error',
      conflicts: mergeResult.conflicts
    }
  }

  // Post-merge CSS dedup
  try {
    const dedupReport = await runPostMergeDedup(repoPath)
    if (dedupReport?.warnings.length) {
      const existing = _getTask(taskId)
      const warnText = `\n\n## CSS Near-Duplicate Warnings\n${dedupReport.warnings.join('\n')}`
      _updateTask(taskId, { notes: (existing?.notes || '') + warnText })
    }
  } catch (err) {
    logger.warn(`[shipIt] Post-merge dedup failed (non-fatal): ${err}`)
  }

  // Push — on failure, bail out leaving the squash commit on local main,
  // the worktree on disk, and the task in `review` so the user can retry.
  // Previously this was logged as a warning and the handler still cleaned up
  // + marked done, stranding the commit with no UI retry path.
  try {
    await execFileAsync('git', ['push', 'origin', 'HEAD'], { cwd: repoPath, env })
    logger.info(`[shipIt] Push succeeded for task ${taskId}`)
  } catch (pushErr) {
    const errMsg = getErrorMessage(pushErr)
    logger.error(`[shipIt] Push failed for task ${taskId}: ${errMsg}`)
    return {
      success: false,
      error: `Push failed: ${errMsg}. The squash commit is on local main but hasn't reached origin. The worktree is preserved and the task remains in review so you can retry.`
    }
  }

  // Clean up worktree + branch (only reached on successful push)
  await cleanupWorktree(task.worktree_path, branch, repoPath, env)

  // Mark task done
  const updated = _updateTask(taskId, {
    status: 'done',
    completed_at: nowIso(),
    worktree_path: null
  })
  if (updated) notifySprintMutation('updated', updated)
  onStatusTerminal(taskId, 'done')

  return { success: true, pushed: true }
}

/**
 * Manually rebase agent branch onto current origin/main, update task metadata.
 */
export async function rebase(input: RebaseInput): Promise<RebaseResult> {
  const { taskId, env } = input

  const task = _getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)

  // Rebase via service
  const result = await rebaseOntoMain(task.worktree_path, env, logger)
  if (!result.success) {
    // Extract conflict files
    const conflicts: string[] = []
    try {
      const { stdout: conflictOut } = await execFileAsync(
        'git',
        ['diff', '--name-only', '--diff-filter=U'],
        { cwd: task.worktree_path, env }
      )
      conflicts.push(...conflictOut.trim().split('\n').filter(Boolean))
    } catch {
      /* best-effort */
    }
    return { success: false, error: result.notes, conflicts }
  }

  // Get the new base SHA and persist it
  const { stdout: baseShaOut } = await execFileAsync('git', ['rev-parse', 'origin/main'], {
    cwd: task.worktree_path,
    env
  })
  const baseSha = baseShaOut.trim()

  const updated = _updateTask(taskId, {
    rebase_base_sha: baseSha,
    rebased_at: nowIso()
  })
  if (updated) notifySprintMutation('updated', updated)

  return { success: true, baseSha }
}
