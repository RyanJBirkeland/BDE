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
import { MAX_NO_COMMITS_RETRIES } from './prompt-constants'
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
 * Thrown when the agent's branch tip commit does not reference the expected
 * task identifiers. Signals that some other process — or a stale branch —
 * produced the tip, not the agent we just ran. Caller must transition the
 * task to `failed` rather than `review`.
 */
export class BranchTipMismatchError extends Error {
  constructor(
    public readonly expectedTokens: string[],
    public readonly actualSubject: string
  ) {
    super(
      `Branch tip mismatch — expected one of [${expectedTokens.join(', ')}] in subject, got: ${actualSubject}`
    )
    this.name = 'BranchTipMismatchError'
  }
}

/**
 * Extracts a `(T-N)` token (e.g. `(T-42)`) from a task title, if present.
 * BDE convention: sprint task titles often carry a `(T-N)` suffix so that
 * commit messages written by the agent can reference the task number.
 */
function extractTaskNumberToken(title: string): string | null {
  const match = /\(T-\d+\)/i.exec(title)
  return match ? match[0] : null
}

/**
 * Builds the set of identifiers the branch tip commit MUST reference for the
 * agent's work to be accepted. Any one of these appearing in the commit body
 * or trailers is sufficient.
 */
function buildExpectedTipTokens(task: {
  id: string
  title: string
  agent_run_id?: string | null
}): string[] {
  const tokens: string[] = []
  if (task.agent_run_id) tokens.push(task.agent_run_id)
  const numberToken = extractTaskNumberToken(task.title)
  if (numberToken) tokens.push(numberToken)
  // Task title substring — first meaningful phrase, trimmed to keep the
  // match permissive without matching noise.
  const titleHead = task.title
    .replace(/\(T-\d+\)/gi, '')
    .trim()
    .slice(0, 40)
  if (titleHead) tokens.push(titleHead)
  tokens.push(task.id)
  return tokens
}

/**
 * Extract the task-id slug from a BDE agent branch name.
 *
 * BDE generates branches as `agent/t-<idSlug>-<titleSlug>-<groupHash>` where
 * `<groupHash>` is always 8 lowercase hex chars. Returns the `<idSlug>` part
 * (e.g. '11', 'abc123', '20260420') so callers can match it against the
 * task's full id by suffix.
 *
 * Returns null when the branch name does not match the expected shape —
 * callers should fall back to commit-subject matching or treat as
 * "no task linkage" per their policy.
 */
export function extractTaskIdFromBranch(branch: string): string | null {
  const match = /^agent\/t-([a-zA-Z0-9]+)-.+-[a-f0-9]{8}$/.exec(branch)
  return match?.[1] ?? null
}

/**
 * Check whether a branch name identifies a given task.
 *
 * Uses extractTaskIdFromBranch to pull the `<idSlug>` from the branch, then
 * checks that the task id ends with `t-<idSlug>` (case-insensitive). Accepts
 * both short ids ('t-11') and long ones ('audit-20260420-t-11').
 */
export function branchMatchesTask(branch: string, taskId: string): boolean {
  const slug = extractTaskIdFromBranch(branch)
  if (!slug) return false
  return taskId.toLowerCase().endsWith(`t-${slug.toLowerCase()}`)
}

/**
 * Reads the tip commit message (subject + body) for a branch.
 *
 * Reads FROM the main repo — the branch ref lives there even when the
 * worktree is elsewhere. Using the same cwd keeps the check consistent
 * with how branches are actually created by git worktree add.
 */
export type ReadTipCommit = (branch: string, repoPath: string) => Promise<string>

const defaultReadTipCommit: ReadTipCommit = async (branch, repoPath) => {
  const env = buildAgentEnv()
  const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%B', branch], {
    cwd: repoPath,
    env
  })
  return stdout.trim()
}

/**
 * Verifies that the agent's branch tip legitimately belongs to this task.
 *
 * Primary signal: the branch name itself (e.g. `agent/t-11-...-<hash>`) —
 * BDE generates branches deterministically from the task id, so a name match
 * is strong evidence of linkage and short-circuits before any subprocess.
 *
 * Fallback signal: the commit message references a task identifier
 * (agent_run_id, (T-N), title head, or task id). This covers non-standard
 * branch names and preserves forward compatibility with other tools.
 *
 * Throws BranchTipMismatchError when neither signal matches — defense against
 * a stale branch tip or a cross-task leak that survived worktree setup.
 */
export async function assertBranchTipMatches(
  task: { id: string; title: string; agent_run_id?: string | null },
  agentBranch: string,
  repoPath: string,
  readTipCommit: ReadTipCommit = defaultReadTipCommit
): Promise<void> {
  if (branchMatchesTask(agentBranch, task.id)) return

  const commitMessage = await readTipCommit(agentBranch, repoPath)
  const expectedTokens = buildExpectedTipTokens(task)
  const hasMatch = expectedTokens.some((token) =>
    commitMessage.toLowerCase().includes(token.toLowerCase())
  )
  if (!hasMatch) {
    const firstLine = commitMessage.split('\n')[0] ?? ''
    throw new BranchTipMismatchError(expectedTokens, firstLine)
  }
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
  resolveFailure: (
    opts: {
      taskId: string
      retryCount: number
      notes?: string | undefined
      repo: IAgentTaskRepository
    },
    logger?: Logger
  ) => boolean
}

/**
 * Check if branch has any commits ahead of origin/main.
 * Returns true if commits exist, false if none (triggers retry/failure).
 */
export async function hasCommitsAheadOfMain(opts: CommitCheckContext): Promise<boolean> {
  const {
    taskId,
    branch,
    worktreePath,
    agentSummary,
    retryCount,
    repo,
    logger,
    onTaskTerminal,
    resolveFailure
  } = opts
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

      if (retryCount >= MAX_NO_COMMITS_RETRIES) {
        await failTaskExhaustedNoCommits(taskId, branch, repo, logger, onTaskTerminal)
        return false
      }

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
    logger.warn(
      `[completion] git rev-list check failed for task ${taskId} — assuming commits exist: ${err}`
    )
  }
  return true
}

/**
 * Terminal-fail a task that has hit the no_commits retry cap.
 *
 * Distinct from the generic `resolveFailure` path because:
 *   1. `failure_reason` is set to the specific sentinel `no-commits-exhausted`
 *      so dashboards and filters can distinguish "agent gave up" from other
 *      retry exhaustions (test failures, timeouts, etc.).
 *   2. The notes string points the operator at the logs instead of truncating
 *      the last stack trace — there is no exception here, just silence.
 */
async function failTaskExhaustedNoCommits(
  taskId: string,
  branch: string,
  repo: IAgentTaskRepository,
  logger: Logger,
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
): Promise<void> {
  logger.warn(
    `[completion] Task ${taskId}: no commits on branch ${branch} after ${MAX_NO_COMMITS_RETRIES} attempts — marking failed`
  )

  const task = repo.getTask(taskId)
  const durationMs =
    task?.started_at !== undefined && task.started_at !== null
      ? Date.now() - new Date(task.started_at).getTime()
      : undefined

  try {
    repo.updateTask(taskId, {
      status: 'failed',
      completed_at: nowIso(),
      claimed_by: null,
      needs_review: true,
      failure_reason: 'no-commits-exhausted',
      notes: `Agent exited without commits ${MAX_NO_COMMITS_RETRIES} times; marked failed. Investigate logs at ~/.bde/bde.log`,
      ...(durationMs !== undefined ? { duration_ms: durationMs } : {})
    })
  } catch (err) {
    logger.error(`[completion] Failed to mark task ${taskId} no-commits-exhausted: ${err}`)
  }

  await onTaskTerminal(taskId, 'failed')
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
  attemptAutoMerge: (opts: {
    taskId: string
    title: string
    branch: string
    worktreePath: string
    repo: IAgentTaskRepository
    logger: Logger
    onTaskTerminal: (taskId: string, status: string) => Promise<void>
  }) => Promise<void>
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
