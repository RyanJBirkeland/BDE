/**
 * completion.ts — Thin dispatcher for agent task completion.
 *
 * resolveSuccess() orchestrates the success path (phases in resolve-success-phases.ts).
 * resolveFailure() delegates to resolve-failure-phases.ts.
 * findOrCreatePR() is a re-export for callers that need PR creation from this module.
 *
 * No business logic lives here — this file is the public API surface.
 * All existing imports from other files pointing to completion.ts remain valid.
 */
import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import { buildAgentEnv } from '../env-utils'
import { findOrCreatePR as findOrCreatePRUtil } from '../lib/git-operations'
import {
  verifyWorktreeExists,
  detectAgentBranch,
  autoCommitPendingChanges,
  performRebaseOntoMain,
  hasCommitsAheadOfMain,
  transitionTaskToReview,
} from './resolve-success-phases'
import { resolveFailure as resolveFailurePhase } from './resolve-failure-phases'
import { evaluateAutoMerge } from './auto-merge-coordinator'
import {
  detectUntouchedTests,
  listChangedFiles,
  formatAdvisory,
} from './test-touch-check'

export type { ResolveFailureContext } from './resolve-failure-phases'

export interface ResolveSuccessContext {
  taskId: string
  worktreePath: string
  title: string
  ghRepo: string
  onTaskTerminal: (taskId: string, status: string) => Promise<void>
  agentSummary?: string | null
  retryCount: number
  repo: IAgentTaskRepository
  /**
   * Absolute path to the MAIN repo checkout (not the worktree). Used by the
   * untouched-test advisory to look up test files alongside changed source.
   * When omitted (legacy callers, tests), the advisory falls back to the
   * worktree path.
   */
  repoPath?: string
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

export async function resolveSuccess(opts: ResolveSuccessContext, logger: Logger): Promise<void> {
  const { taskId, worktreePath, title, onTaskTerminal, agentSummary, retryCount, repo, repoPath } = opts

  const worktreeExists = await verifyWorktreeExists(taskId, worktreePath, repo, logger, onTaskTerminal)
  if (!worktreeExists) return

  const branch = await detectAgentBranch(taskId, worktreePath, repo, logger, onTaskTerminal)
  if (!branch) return

  await autoCommitPendingChanges(taskId, worktreePath, title, logger)

  const rebaseOutcome = await performRebaseOntoMain(taskId, worktreePath, logger)

  const hasCommits = await hasCommitsAheadOfMain({
    taskId,
    branch,
    worktreePath,
    agentSummary,
    retryCount,
    repo,
    logger,
    onTaskTerminal,
    resolveFailure: resolveFailurePhase,
  })
  if (!hasCommits) return

  await annotateIfTestsUntouched(taskId, branch, worktreePath, repoPath, repo, logger)

  await transitionTaskToReview(taskId, branch, worktreePath, title, rebaseOutcome, repo, logger, onTaskTerminal, evaluateAutoMerge)
}

/**
 * Pre-review advisory: checks whether the agent changed source files whose
 * sibling test files exist but were not also changed. Appends a single-line
 * warning to the task's `notes` so the human reviewer sees it in Code Review.
 *
 * Intentionally advisory-only — never blocks the review transition. Failures
 * in git diff or fs lookups are logged and swallowed so a flaky check cannot
 * stall the success path.
 */
async function annotateIfTestsUntouched(
  taskId: string,
  agentBranch: string,
  worktreePath: string,
  repoPath: string | undefined,
  repo: IAgentTaskRepository,
  logger: Logger
): Promise<void> {
  const testCheckRepoPath = repoPath ?? worktreePath
  const env = buildAgentEnv()

  try {
    const changedFiles = await listChangedFiles(agentBranch, worktreePath, env, { logger })
    if (changedFiles.length === 0) return

    const untouched = detectUntouchedTests(changedFiles, testCheckRepoPath, { logger })
    if (untouched.length === 0) return

    appendAdvisoryNote(taskId, formatAdvisory(untouched), repo, logger)
  } catch (err) {
    logger.warn(
      `[completion] Untouched-test check skipped for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * Appends an advisory line to the task's existing `notes`, preserving any
 * prior notes (e.g. rebase warnings) so multiple advisories can coexist.
 */
function appendAdvisoryNote(
  taskId: string,
  advisory: string,
  repo: IAgentTaskRepository,
  logger: Logger
): void {
  try {
    const existing = repo.getTask(taskId)?.notes ?? ''
    const combined = existing ? `${existing}\n${advisory}` : advisory
    repo.updateTask(taskId, { notes: combined })
    logger.info(`[completion] Annotated task ${taskId} with test-touch advisory: ${advisory}`)
  } catch (err) {
    logger.warn(`[completion] Failed to persist test-touch advisory for ${taskId}: ${err}`)
  }
}

export function resolveFailure(
  opts: { taskId: string; retryCount: number; notes?: string; repo: IAgentTaskRepository },
  logger?: Logger
): boolean {
  return resolveFailurePhase(opts, logger)
}
