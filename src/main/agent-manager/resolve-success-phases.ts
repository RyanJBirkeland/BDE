/**
 * Success-path phase functions for agent task completion.
 *
 * Executed in sequence by resolveSuccess() in completion.ts:
 *   1. verifyWorktreeExists — guard: worktree must be present
 *   2. detectAgentBranch    — guard: branch name must be non-empty
 *   3. autoCommitPendingChanges — best-effort commit of uncommitted work
 *   4. performRebaseOntoMain    — rebase agent branch onto origin/main
 *   5. verifyCommitsExist   — guard: agent must have produced commits
 *
 * transitionTaskToReview is called by resolveSuccess() after all guards pass.
 */
import { existsSync } from 'node:fs'
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'
import { MAX_RETRIES, AGENT_SUMMARY_MAX_LENGTH } from './types'
import type { Logger } from '../logger'
import { broadcastCoalesced } from '../broadcast'
import type { AgentEvent } from '../../shared/types'
import { nowIso } from '../../shared/time'
import { rebaseOntoMain, autoCommitIfDirty } from '../lib/git-operations'
import { transitionToReview } from './review-transition'

export interface RebaseOutcome {
  rebaseNote: string | undefined
  rebaseBaseSha: string | undefined
  rebaseSucceeded: boolean
}

/**
 * Fail task with error status, emit agent event, and call terminal callback.
 * Consolidates error handling pattern used in resolveSuccess guards.
 */
export async function failTaskWithError(
  taskId: string,
  message: string,
  notes: string,
  repo: IAgentTaskRepository,
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
    // DB failure after an already-error path: log as error but do not re-throw —
    // onTaskTerminal must still fire so dependency resolution and metrics run.
    logger.error(`[completion] Failed to update task ${taskId} after error: ${e}`)
  }

  await onTaskTerminal(taskId, 'error')
}

async function detectBranch(worktreePath: string): Promise<string> {
  const env = buildAgentEnv()
  const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: worktreePath,
    env
  })
  return stdout.trim()
}

export async function verifyWorktreeExists(
  taskId: string,
  worktreePath: string,
  repo: IAgentTaskRepository,
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

export async function detectAgentBranch(
  taskId: string,
  worktreePath: string,
  repo: IAgentTaskRepository,
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

export async function autoCommitPendingChanges(
  taskId: string,
  worktreePath: string,
  title: string,
  logger: Logger
): Promise<void> {
  try {
    await autoCommitIfDirty(worktreePath, title, logger)
  } catch (err) {
    // Auto-commit is best-effort: if it fails the agent's explicit commits are still present.
    // The subsequent rev-list check will catch the no-commits case if the worktree is truly empty.
    logger.error(`[completion] Auto-commit failed for task ${taskId}: ${err}`)
  }
}

export async function performRebaseOntoMain(
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
    // Rebase failure (e.g. conflict) is non-fatal: the task transitions to 'review' with
    // rebaseSucceeded=false so the Code Review Station can surface the conflict to the user.
    logger.error(`[completion] Rebase step failed for task ${taskId}: ${err}`)
    return {
      rebaseNote: 'Rebase onto main failed — manual conflict resolution needed.',
      rebaseBaseSha: undefined,
      rebaseSucceeded: false
    }
  }
}

interface CommitCheckContext {
  taskId: string
  branch: string
  worktreePath: string
  agentSummary: string | null | undefined
  retryCount: number
  repo: IAgentTaskRepository
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  resolveFailure: (opts: { taskId: string; retryCount: number; notes?: string; repo: IAgentTaskRepository }, logger?: Logger) => boolean
}

/**
 * Check if branch has any commits ahead of origin/main.
 * Returns true if commits exist, false if none (triggers retry/failure).
 */
export async function hasCommitsAheadOfMain(opts: CommitCheckContext): Promise<boolean> {
  const { taskId, branch, worktreePath, agentSummary, retryCount, repo, logger, onTaskTerminal, resolveFailure } =
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
  } catch (err) {
    // rev-list can fail if the remote ref doesn't exist yet (fresh worktree, no fetch).
    // Assume commits exist so the agent's work proceeds to review rather than silently failing.
    logger.warn(`[completion] git rev-list check failed for task ${taskId} — assuming commits exist: ${err}`)
  }
  return true
}

export async function transitionTaskToReview(
  taskId: string,
  branch: string,
  worktreePath: string,
  title: string,
  rebaseOutcome: RebaseOutcome,
  repo: IAgentTaskRepository,
  logger: Logger,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>,
  attemptAutoMerge: (opts: { taskId: string; title: string; branch: string; worktreePath: string; repo: IAgentTaskRepository; logger: Logger; onTaskTerminal: (taskId: string, status: string) => Promise<void> }) => Promise<void>
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
