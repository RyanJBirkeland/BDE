import { existsSync } from 'node:fs'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'
import { MAX_RETRIES, AGENT_SUMMARY_MAX_LENGTH, RETRY_BACKOFF_BASE_MS, RETRY_BACKOFF_CAP_MS } from './types'
import type { Logger } from '../logger'
import { broadcastCoalesced } from '../broadcast'
import type { AgentEvent } from '../../shared/types'
import { nowIso } from '../../shared/time'
import {
  rebaseOntoMain,
  findOrCreatePR as findOrCreatePRUtil,
  autoCommitIfDirty,
  executeSquashMerge
} from './git-operations'
import { transitionToReview } from './review-transition'
import { classifyFailureReason } from './failure-classifier'
import { evaluateAutoMergePolicy } from './auto-merge-policy'

export interface ResolveSuccessContext {
  taskId: string
  worktreePath: string
  title: string
  ghRepo: string
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  agentSummary?: string | null
  retryCount: number
  repo: ISprintTaskRepository
}

export interface ResolveFailureContext {
  taskId: string
  retryCount: number
  notes?: string
  repo: ISprintTaskRepository
}

interface CommitCheckContext {
  taskId: string
  branch: string
  worktreePath: string
  agentSummary: string | null | undefined
  retryCount: number
  repo: ISprintTaskRepository
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
}

interface AutoMergeContext {
  taskId: string
  title: string
  branch: string
  worktreePath: string
  repo: ISprintTaskRepository
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
}

async function detectBranch(worktreePath: string): Promise<string> {
  const env = buildAgentEnv()
  const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: worktreePath,
    env
  })
  return stdout.trim()
}

/**
 * Get repository config for a task from settings.
 * Returns null if task or repo config not found.
 */
async function getRepoConfig(
  taskId: string,
  repo: ISprintTaskRepository,
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

/**
 * Fail task with error status, emit agent event, and call terminal callback.
 * Consolidates error handling pattern used in resolveSuccess guards.
 */
async function failTaskWithError(
  taskId: string,
  message: string,
  notes: string,
  repo: ISprintTaskRepository,
  logger: Logger,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
): Promise<void> {
  logger.error(`[completion] ${message}`)

  const event: AgentEvent = {
    type: 'agent:error',
    message,
    timestamp: Date.now()
  }
  broadcastCoalesced('agent:event', { agentId: taskId, event })

  try {
    repo.updateTask(taskId, {
      status: 'error',
      completed_at: nowIso(),
      notes,
      claimed_by: null
    })
  } catch (e) {
    logger.warn(`[completion] Failed to update task ${taskId} after error: ${e}`)
  }

  await onTaskTerminal(taskId, 'error')
}

/**
 * Check if branch has any commits ahead of origin/main.
 * Returns true if commits exist, false if none (triggers retry/failure).
 */
async function hasCommitsAheadOfMain(opts: CommitCheckContext): Promise<boolean> {
  const { taskId, branch, worktreePath, agentSummary, retryCount, repo, logger, onTaskTerminal } =
    opts
  const env = buildAgentEnv()
  try {
    const { stdout: diffOut } = await execFileAsync(
      'git',
      ['rev-list', '--count', `origin/main..${branch}`],
      { cwd: worktreePath, env }
    )
    if (parseInt(diffOut.trim(), 10) === 0) {
      const summaryNote = agentSummary
        ? `Agent produced no commits. Last output: ${agentSummary.slice(0, AGENT_SUMMARY_MAX_LENGTH)}`
        : 'Agent produced no commits (no output captured)'
      const isTerminal = resolveFailure({ taskId, retryCount, notes: summaryNote, repo }, logger)
      if (isTerminal) {
        logger.warn(
          `[completion] Task ${taskId}: no commits on branch ${branch} — exhausted retries`
        )
        await onTaskTerminal(taskId, 'failed')
      } else {
        logger.warn(
          `[completion] Task ${taskId}: no commits on branch ${branch} — requeuing (retry ${retryCount + 1}/${MAX_RETRIES})`
        )
      }
      return false
    }
  } catch {
    // If rev-list fails, assume commits exist and continue
  }
  return true
}

async function attemptAutoMerge(opts: AutoMergeContext): Promise<void> {
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
    logger.warn(`[completion] Auto-review check failed for task ${taskId}: ${err}`)
  }
}

/**
 * Exported wrapper for findOrCreatePR from git-operations.
 * Used by review-approve-push flow (push + PR creation deferred from agent completion).
 */
export async function findOrCreatePR(
  worktreePath: string,
  branch: string,
  title: string,
  ghRepo: string,
  logger: Logger
): Promise<{ prUrl: string | null; prNumber: number | null }> {
  const env = buildAgentEnv()
  return findOrCreatePRUtil(worktreePath, branch, title, ghRepo, env, logger)
}

async function verifyWorktreeExists(
  taskId: string,
  worktreePath: string,
  repo: ISprintTaskRepository,
  logger: Logger,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
): Promise<boolean> {
  if (existsSync(worktreePath)) {
    return true
  }
  await failTaskWithError(
    taskId,
    `Worktree path no longer exists for task ${taskId}: ${worktreePath}`,
    `Worktree evicted before completion (${worktreePath}). Use ~/worktrees/ instead of /tmp/.`,
    repo,
    logger,
    onTaskTerminal
  )
  return false
}

async function detectAgentBranch(
  taskId: string,
  worktreePath: string,
  repo: ISprintTaskRepository,
  logger: Logger,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
): Promise<string | null> {
  let branch: string
  try {
    branch = await detectBranch(worktreePath)
  } catch (err) {
    await failTaskWithError(
      taskId,
      `Failed to detect branch for task ${taskId}: ${err}`,
      'Failed to detect branch',
      repo,
      logger,
      onTaskTerminal
    )
    return null
  }

  if (!branch) {
    await failTaskWithError(
      taskId,
      `Empty branch name for task ${taskId}`,
      'Empty branch name',
      repo,
      logger,
      onTaskTerminal
    )
    return null
  }

  return branch
}

async function autoCommitPendingChanges(
  taskId: string,
  worktreePath: string,
  title: string,
  logger: Logger
): Promise<void> {
  try {
    await autoCommitIfDirty(worktreePath, title, logger)
  } catch (err) {
    logger.warn(`[completion] Auto-commit failed for task ${taskId}: ${err}`)
    // Continue — push will fail naturally if there are no commits
  }
}

interface RebaseOutcome {
  rebaseNote: string | undefined
  rebaseBaseSha: string | undefined
  rebaseSucceeded: boolean
}

async function rebaseOnMain(
  taskId: string,
  worktreePath: string,
  logger: Logger
): Promise<RebaseOutcome> {
  const env = buildAgentEnv()
  try {
    const rebaseResult = await rebaseOntoMain(worktreePath, env, logger)
    if (!rebaseResult.success) {
      return { rebaseNote: rebaseResult.notes, rebaseBaseSha: undefined, rebaseSucceeded: false }
    }
    return { rebaseNote: undefined, rebaseBaseSha: rebaseResult.baseSha, rebaseSucceeded: true }
  } catch (err) {
    logger.warn(`[completion] Rebase step failed for task ${taskId}: ${err}`)
    return {
      rebaseNote: 'Rebase onto main failed — manual conflict resolution needed.',
      rebaseBaseSha: undefined,
      rebaseSucceeded: false
    }
  }
}

async function verifyCommitsExist(
  taskId: string,
  branch: string,
  worktreePath: string,
  agentSummary: string | null | undefined,
  retryCount: number,
  repo: ISprintTaskRepository,
  logger: Logger,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
): Promise<boolean> {
  return hasCommitsAheadOfMain({
    taskId,
    branch,
    worktreePath,
    agentSummary,
    retryCount,
    repo,
    logger,
    onTaskTerminal
  })
}

async function transitionTaskToReview(
  taskId: string,
  branch: string,
  worktreePath: string,
  title: string,
  rebaseOutcome: RebaseOutcome,
  repo: ISprintTaskRepository,
  logger: Logger,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
): Promise<void> {
  logger.info(
    `[completion] Task ${taskId}: agent finished with commits on branch ${branch} — transitioning to review`
  )

  await transitionToReview({
    taskId,
    worktreePath,
    rebaseNote: rebaseOutcome.rebaseNote,
    rebaseBaseSha: rebaseOutcome.rebaseBaseSha,
    rebaseSucceeded: rebaseOutcome.rebaseSucceeded,
    repo,
    logger
  })

  await attemptAutoMerge({ taskId, title, branch, worktreePath, repo, logger, onTaskTerminal })

  // The task enters 'review' status to await human inspection — this is NOT a terminal state.
  // The worktree must stay alive so the Code Review Station can show diffs and allow merge/discard.
  // onTaskTerminal is intentionally NOT called here; it fires only when the human takes a final action.
}

export async function resolveSuccess(opts: ResolveSuccessContext, logger: Logger): Promise<void> {
  const { taskId, worktreePath, title, onTaskTerminal, agentSummary, retryCount, repo } = opts

  const worktreeExists = await verifyWorktreeExists(taskId, worktreePath, repo, logger, onTaskTerminal)
  if (!worktreeExists) return

  const branch = await detectAgentBranch(taskId, worktreePath, repo, logger, onTaskTerminal)
  if (!branch) return

  await autoCommitPendingChanges(taskId, worktreePath, title, logger)

  const rebaseOutcome = await rebaseOnMain(taskId, worktreePath, logger)

  const hasCommits = await verifyCommitsExist(
    taskId, branch, worktreePath, agentSummary, retryCount, repo, logger, onTaskTerminal
  )
  if (!hasCommits) return

  await transitionTaskToReview(taskId, branch, worktreePath, title, rebaseOutcome, repo, logger, onTaskTerminal)
}

export function resolveFailure(opts: ResolveFailureContext, logger?: Logger): boolean {
  const { taskId, retryCount, notes, repo } = opts

  // Classify failure reason for structured filtering
  const failureReason = classifyFailureReason(notes)

  // Determine if this is a terminal state (exhausted retries)
  const isTerminal = retryCount >= MAX_RETRIES

  // Calculate duration from started_at to now (for terminal failures only)
  const task = repo.getTask(taskId)
  let durationMs: number | undefined
  if (isTerminal && task?.started_at) {
    const startTime = new Date(task.started_at).getTime()
    const endTime = Date.now()
    durationMs = endTime - startTime
  }

  try {
    if (!isTerminal) {
      // Exponential backoff: 30s, 60s, 120s, capped at 5 minutes
      const backoffMs = Math.min(RETRY_BACKOFF_CAP_MS, RETRY_BACKOFF_BASE_MS * Math.pow(2, retryCount))
      const nextEligibleAt = new Date(Date.now() + backoffMs).toISOString()
      repo.updateTask(taskId, {
        status: 'queued',
        retry_count: retryCount + 1,
        claimed_by: null,
        next_eligible_at: nextEligibleAt,
        failure_reason: failureReason,
        ...(notes ? { notes } : {})
      })
      return false // not terminal
    } else {
      repo.updateTask(taskId, {
        status: 'failed',
        completed_at: nowIso(),
        claimed_by: null,
        needs_review: true,
        failure_reason: failureReason,
        ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
        ...(notes ? { notes } : {})
      })
      return true // terminal
    }
  } catch (err) {
    logger?.error(`[completion] Failed to update task ${taskId} during failure resolution: ${err}`)
    // Still return correct terminal status even if DB update failed
    // so caller knows to trigger onStatusTerminal callback
    return isTerminal
  }
}
