/**
 * completion.ts — Barrel re-export for agent task completion.
 *
 * Public API surface for all callers. Implementation lives in:
 *   - success-pipeline.ts      — resolveSuccess, SuccessPhase pipeline
 *   - pre-review-advisors.ts   — PreReviewAdvisor checks before review transition
 *   - verification-gate.ts     — verifyBranchTipOrFail, verifyWorktreeOrFail
 *   - resolve-failure-phases.ts — resolveFailure
 *   - git-operations.ts        — findOrCreatePR
 *
 * No business logic lives here — this file is the public API surface.
 * All existing imports from other files pointing to completion.ts remain valid.
 */

/** Hard timeout for all git subprocess calls in the completion path. */
const GIT_EXEC_TIMEOUT_MS = 30_000

import type { IAgentTaskRepository } from '../data/sprint-task-repository'
import type { Logger } from '../logger'
import { buildAgentEnv } from '../env-utils'
import { execFileAsync } from '../lib/async-utils'
import { findOrCreatePR as findOrCreatePRUtil } from '../lib/git-operations'
import { resolveFailure as resolveFailurePhase, type ResolveFailureResult } from './resolve-failure-phases'

export type { ResolveFailureContext, ResolveFailureResult } from './resolve-failure-phases'

export { resolveSuccess, type ResolveSuccessContext } from './success-pipeline'
export type { SuccessPhaseContext, SuccessPhase } from './success-pipeline'
export { PipelineAbortError } from './success-pipeline'

export type { PreReviewAdvisor, PreReviewAdvisorContext } from './pre-review-advisors'
export { preReviewAdvisors, runPreReviewAdvisors } from './pre-review-advisors'

export { appendAdvisoryNote, verifyBranchTipOrFail, verifyWorktreeOrFail } from './verification-gate'

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
 * Deletes the agent branch in the main repo before the drain loop recreates
 * the worktree on a retry. Swallows errors when the branch doesn't exist —
 * this is defense against a stale branch ref surviving between attempts.
 */
export async function deleteAgentBranchBeforeRetry(
  repoPath: string,
  agentBranch: string,
  logger: Logger
): Promise<void> {
  const env = buildAgentEnv()
  try {
    await execFileAsync('git', ['branch', '-D', agentBranch], { cwd: repoPath, env, timeout: GIT_EXEC_TIMEOUT_MS })
    logger.info(`[completion] deleted agent branch before retry: ${agentBranch}`)
  } catch (err) {
    // Branch may not exist (first-time retry, already cleaned, etc.) — non-fatal.
    logger.info(
      `[completion] branch delete before retry skipped for ${agentBranch}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export async function resolveFailure(
  opts: {
    taskId: string
    retryCount: number
    notes?: string | undefined
    repo: IAgentTaskRepository
  },
  logger?: Logger
): Promise<ResolveFailureResult> {
  return resolveFailurePhase(opts, logger)
}
