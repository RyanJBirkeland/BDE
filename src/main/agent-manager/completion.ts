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
  const { taskId, worktreePath, title, onTaskTerminal, agentSummary, retryCount, repo } = opts

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

  await transitionTaskToReview(taskId, branch, worktreePath, title, rebaseOutcome, repo, logger, onTaskTerminal, evaluateAutoMerge)
}

export function resolveFailure(
  opts: { taskId: string; retryCount: number; notes?: string; repo: IAgentTaskRepository },
  logger?: Logger
): boolean {
  return resolveFailurePhase(opts, logger)
}
