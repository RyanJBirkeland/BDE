import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import { buildAgentEnv } from '../env-utils'
import { MAX_RETRIES, AGENT_SUMMARY_MAX_LENGTH } from './types'
import type { Logger } from '../logger'
import { broadcastCoalesced } from '../broadcast'
import type { AgentEvent, FailureReason } from '../../shared/types'
import type { AutoReviewRule } from '../../shared/types/task-types'
import { nowIso } from '../../shared/time'
import {
  rebaseOntoMain,
  findOrCreatePR as findOrCreatePRUtil,
  autoCommitIfDirty,
  executeSquashMerge
} from './git-operations'
import { transitionToReview } from './review-transition'

const execFile = promisify(execFileCb)

export interface ResolveSuccessOpts {
  taskId: string
  worktreePath: string
  title: string
  ghRepo: string
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  agentSummary?: string | null
  retryCount: number
  repo: ISprintTaskRepository
}

export interface ResolveFailureOpts {
  taskId: string
  retryCount: number
  notes?: string
  repo: ISprintTaskRepository
}

interface CommitCheckOpts {
  taskId: string
  branch: string
  worktreePath: string
  agentSummary: string | null | undefined
  retryCount: number
  repo: ISprintTaskRepository
  logger: Logger
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
}

interface AutoMergeOpts {
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
  const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: worktreePath,
    env
  })
  return stdout.trim()
}


/**
 * Get diff file statistics from git diff --numstat.
 * Returns array of {path, additions, deletions} or null if no changes.
 */
async function getDiffFileStats(
  worktreePath: string
): Promise<Array<{ path: string; additions: number; deletions: number }> | null> {
  const env = buildAgentEnv()
  const { stdout: numstatOut } = await execFile(
    'git',
    ['diff', '--numstat', 'origin/main...HEAD'],
    { cwd: worktreePath, env }
  )

  if (!numstatOut.trim()) {
    return null
  }

  return numstatOut
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t')
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10)
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10)
      const filePath = parts.slice(2).join('\t')
      return { path: filePath, additions, deletions }
    })
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
async function hasCommitsAheadOfMain(opts: CommitCheckOpts): Promise<boolean> {
  const { taskId, branch, worktreePath, agentSummary, retryCount, repo, logger, onTaskTerminal } =
    opts
  const env = buildAgentEnv()
  try {
    const { stdout: diffOut } = await execFile(
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

/**
 * Attempt auto-merge based on configured auto-review rules.
 * Evaluates rules against diff stats and executes squash merge if qualified.
 */
async function attemptAutoMerge(opts: AutoMergeOpts): Promise<void> {
  const { taskId, title, branch, worktreePath, repo, logger, onTaskTerminal } = opts
  const { getSettingJson } = await import('../settings')
  const rules = getSettingJson<AutoReviewRule[]>('autoReview.rules')

  if (!rules || rules.length === 0) {
    return
  }

  try {
    const files = await getDiffFileStats(worktreePath)
    if (!files) {
      return
    }

    const { evaluateAutoReviewRules } = await import('../services/auto-review')
    const result = evaluateAutoReviewRules(rules, files)

    if (result && result.action === 'auto-merge') {
      logger.info(
        `[completion] Task ${taskId} qualifies for auto-merge (rule: ${result.rule.name}) — merging`
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
        // main has uncommitted changes — leave task in review for human action
        logger.warn(
          `[completion] Task ${taskId} auto-merge skipped: main repo has uncommitted changes — task remains in review`
        )
      } else {
        // 'failed' — merge error, task stays in review
        logger.error(
          `[completion] Task ${taskId} auto-merge failed — task remains in review`
        )
      }
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

/**
 * Classify failure reason from error notes for structured filtering and auto-handling.
 * Pattern matches on common error strings to categorize failure types.
 */
export function classifyFailureReason(notes: string | undefined): FailureReason {
  if (!notes) return 'unknown'

  const lowerNotes = notes.toLowerCase()

  // Auth failures — API key, token, credentials
  if (
    lowerNotes.includes('invalid api key') ||
    lowerNotes.includes('authentication failed') ||
    lowerNotes.includes('unauthorized') ||
    lowerNotes.includes('token expired') ||
    lowerNotes.includes('invalid token')
  ) {
    return 'auth'
  }

  // Timeout failures — watchdog, runtime exceeded
  if (
    lowerNotes.includes('exceeded maximum runtime') ||
    lowerNotes.includes('timeout') ||
    lowerNotes.includes('timed out') ||
    lowerNotes.includes('watchdog')
  ) {
    return 'timeout'
  }

  // Test failures — npm test, vitest, jest
  if (
    lowerNotes.includes('npm test failed') ||
    lowerNotes.includes('test failed') ||
    lowerNotes.includes('vitest failed') ||
    lowerNotes.includes('jest failed') ||
    lowerNotes.includes('tests failed')
  ) {
    return 'test_failure'
  }

  // Compilation failures — tsc, typescript, build errors
  if (
    lowerNotes.includes('compilation error') ||
    lowerNotes.includes('compilation failed') ||
    lowerNotes.includes('tsc failed') ||
    lowerNotes.includes('typescript error') ||
    lowerNotes.includes('type error') ||
    lowerNotes.includes('build failed')
  ) {
    return 'compilation'
  }

  // Spawn failures — process creation, agent spawn
  if (
    lowerNotes.includes('spawn failed') ||
    lowerNotes.includes('failed to spawn') ||
    lowerNotes.includes('enoent') ||
    lowerNotes.includes('command not found')
  ) {
    return 'spawn'
  }

  return 'unknown'
}

export async function resolveSuccess(opts: ResolveSuccessOpts, logger: Logger): Promise<void> {
  const { taskId, worktreePath, title, onTaskTerminal, agentSummary, retryCount, repo } = opts
  const env = buildAgentEnv()

  // 0. Guard: worktree must still exist (macOS /tmp can evict it)
  if (!existsSync(worktreePath)) {
    await failTaskWithError(
      taskId,
      `Worktree path no longer exists for task ${taskId}: ${worktreePath}`,
      `Worktree evicted before completion (${worktreePath}). Use ~/worktrees/ instead of /tmp/.`,
      repo,
      logger,
      onTaskTerminal
    )
    return
  }

  // 1. Detect current branch
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
    return
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
    return
  }

  // 2. Auto-commit any uncommitted changes (agents may not commit before exiting)
  try {
    await autoCommitIfDirty(worktreePath, title, logger)
  } catch (err) {
    logger.warn(`[completion] Auto-commit failed for task ${taskId}: ${err}`)
    // Continue — push will fail naturally if there are no commits
  }

  // 3. Rebase onto origin/main to prevent stale branch merge conflicts
  let rebaseNote: string | undefined
  let rebaseBaseSha: string | undefined
  let rebaseSucceeded = false
  try {
    const rebaseResult = await rebaseOntoMain(worktreePath, env, logger)
    if (!rebaseResult.success) {
      rebaseNote = rebaseResult.notes
    } else {
      rebaseBaseSha = rebaseResult.baseSha
      rebaseSucceeded = true
    }
  } catch (err) {
    logger.warn(`[completion] Rebase step failed for task ${taskId}: ${err}`)
    rebaseNote = 'Rebase onto main failed — manual conflict resolution needed.'
  }

  // 4. Check if there are any commits
  const hasCommits = await hasCommitsAheadOfMain({
    taskId,
    branch,
    worktreePath,
    agentSummary,
    retryCount,
    repo,
    logger,
    onTaskTerminal
  })
  if (!hasCommits) {
    return
  }

  // 5. Transition to review — preserve worktree for code review.
  logger.info(
    `[completion] Task ${taskId}: agent finished with commits on branch ${branch} — transitioning to review`
  )

  await transitionToReview({
    taskId,
    worktreePath,
    rebaseNote,
    rebaseBaseSha,
    rebaseSucceeded,
    repo,
    logger
  })

  // 6. Check auto-review rules — if qualified, auto-merge
  await attemptAutoMerge({ taskId, title, branch, worktreePath, repo, logger, onTaskTerminal })

  // NOTE: If not auto-merged, do NOT call onTaskTerminal — review is not a terminal status.
  // Do NOT clean up worktree — it stays alive for review.
}

export function resolveFailure(opts: ResolveFailureOpts, logger?: Logger): boolean {
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
      const backoffMs = Math.min(300000, 30000 * Math.pow(2, retryCount))
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
