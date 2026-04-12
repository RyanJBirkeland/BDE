/**
 * Review action executor — runs git operations described by a ReviewActionPlan.
 *
 * This module receives an execution plan from review-action-policy.ts and
 * runs the git operations using injected dependencies. All I/O goes through
 * the dependencies (no direct imports from child_process, handlers/, etc.).
 *
 * The executor is responsible for:
 * - Running git operations in order
 * - Handling errors and aborting on failure
 * - Applying task state patches via the repository
 * - Broadcasting mutations and triggering terminal callbacks
 */

import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '../logger'
import type { ISprintTaskRepository } from '../data/sprint-task-repository'
import type { ReviewActionPlan, GitOpDescriptor } from './review-action-policy'
import { rebaseOntoMain } from '../agent-manager/git-operations'
import { mergeAgentBranch, cleanupWorktree, executeMergeStrategy } from './review-merge-service'
import { runPostMergeDedup } from './post-merge-dedup'
import { BDE_TASK_MEMORY_DIR } from '../paths'
import { getErrorMessage } from '../../shared/errors'

const execFile = promisify(execFileCb)

// ============================================================================
// Dependency Injection
// ============================================================================

export interface ReviewActionDeps {
  repo: Pick<ISprintTaskRepository, 'getTask' | 'updateTask'>
  broadcast: (event: string, payload: unknown) => void
  onStatusTerminal: (taskId: string, status: string) => void | Promise<void>
  env: NodeJS.ProcessEnv
  logger: Logger
}

// ============================================================================
// Executor State
// ============================================================================

/**
 * Mutable state accumulated during execution.
 * Used to pass information between git operations (e.g., branch name from getBranch).
 */
interface ExecutorState {
  branch?: string
  baseSha?: string
  conflicts?: string[]
  cssWarnings?: string[]
}

// ============================================================================
// Git Operation Execution
// ============================================================================

/**
 * Execute a single git operation descriptor.
 * Returns updated state or throws on error.
 */
async function executeGitOp(
  op: GitOpDescriptor,
  state: ExecutorState,
  deps: ReviewActionDeps
): Promise<ExecutorState> {
  const { env, logger } = deps

  switch (op.type) {
    // ========================================================================
    // getBranch
    // ========================================================================
    case 'getBranch': {
      if (!op.worktreePath) throw new Error('worktreePath required for getBranch')
      const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: op.worktreePath,
        env
      })
      return { ...state, branch: stdout.trim() }
    }

    // ========================================================================
    // checkStatus
    // ========================================================================
    case 'checkStatus': {
      if (!op.repoPath) throw new Error('repoPath required for checkStatus')
      const { stdout } = await execFile('git', ['status', '--porcelain'], {
        cwd: op.repoPath,
        env
      })
      if (stdout.trim()) {
        throw new Error('Working tree has uncommitted changes. Commit or stash first.')
      }
      return state
    }

    // ========================================================================
    // checkBranch
    // ========================================================================
    case 'checkBranch': {
      if (!op.repoPath) throw new Error('repoPath required for checkBranch')
      const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: op.repoPath,
        env
      })
      const currentBranch = stdout.trim()
      if (currentBranch !== 'main') {
        throw new Error(
          `Main repo checkout is on branch "${currentBranch}", not "main". Switch to main before shipping.`
        )
      }
      return state
    }

    // ========================================================================
    // fetch
    // ========================================================================
    case 'fetch': {
      if (!op.repoPath) throw new Error('repoPath required for fetch')
      logger.info('[executor] Fetching origin/main')
      await execFile('git', ['fetch', 'origin', 'main'], { cwd: op.repoPath, env })
      return state
    }

    // ========================================================================
    // fastForward
    // ========================================================================
    case 'fastForward': {
      if (!op.repoPath) throw new Error('repoPath required for fastForward')
      logger.info('[executor] Fast-forwarding local main to origin/main')
      try {
        await execFile('git', ['merge', '--ff-only', 'origin/main'], { cwd: op.repoPath, env })
      } catch (err: unknown) {
        throw new Error(`Failed to sync local main with origin: ${getErrorMessage(err)}`)
      }
      return state
    }

    // ========================================================================
    // rebase
    // ========================================================================
    case 'rebase': {
      if (!op.worktreePath) throw new Error('worktreePath required for rebase')
      const result = await rebaseOntoMain(op.worktreePath, env, logger)
      if (!result.success) {
        // Extract conflict files
        const conflicts: string[] = []
        try {
          const { stdout: conflictOut } = await execFile(
            'git',
            ['diff', '--name-only', '--diff-filter=U'],
            { cwd: op.worktreePath, env }
          )
          conflicts.push(...conflictOut.trim().split('\n').filter(Boolean))
        } catch {
          /* best-effort */
        }
        const error = new Error(`Rebase failed: ${result.notes}`) as Error & { conflicts?: string[] }
        if (conflicts.length > 0) {
          error.conflicts = conflicts
        }
        throw error
      }
      return { ...state, baseSha: result.baseSha }
    }

    // ========================================================================
    // merge
    // ========================================================================
    case 'merge': {
      if (!state.branch) throw new Error('branch not set in state (getBranch must run first)')
      if (!op.repoPath && !op.worktreePath)
        throw new Error('repoPath or worktreePath required for merge')
      if (!op.strategy) throw new Error('strategy required for merge')
      if (!op.taskId) throw new Error('taskId required for merge')
      if (!op.taskTitle) throw new Error('taskTitle required for merge')

      // If worktreePath is provided, use mergeAgentBranch (includes rebase + merge + dedup)
      if (op.worktreePath) {
        const result = await mergeAgentBranch({
          worktreePath: op.worktreePath,
          branch: state.branch,
          repoPath: op.repoPath!,
          strategy: op.strategy,
          taskId: op.taskId,
          taskTitle: op.taskTitle,
          env
        })
        if (!result.success) {
          const error = new Error(result.error ?? 'Unknown merge error') as Error & {
            conflicts?: string[]
          }
          error.conflicts = result.conflicts
          throw error
        }
      } else {
        // Otherwise use executeMergeStrategy (merge only, no rebase)
        const result = await executeMergeStrategy(
          state.branch,
          op.repoPath!,
          op.strategy,
          op.taskId,
          op.taskTitle,
          env
        )
        if (!result.success) {
          const error = new Error(result.error ?? 'Unknown merge error') as Error & {
            conflicts?: string[]
          }
          error.conflicts = result.conflicts
          throw error
        }
      }
      return state
    }

    // ========================================================================
    // cssDedup
    // ========================================================================
    case 'cssDedup': {
      if (!op.repoPath) throw new Error('repoPath required for cssDedup')
      if (!op.taskId) throw new Error('taskId required for cssDedup')
      try {
        const dedupReport = await runPostMergeDedup(op.repoPath)
        if (dedupReport?.warnings.length) {
          logger.info(`[executor] CSS dedup warnings: ${dedupReport.warnings.length}`)
          return { ...state, cssWarnings: dedupReport.warnings }
        }
      } catch (err) {
        logger.warn(`[executor] Post-merge dedup failed (non-fatal): ${err}`)
      }
      return state
    }

    // ========================================================================
    // push
    // ========================================================================
    case 'push': {
      if (!op.repoPath) throw new Error('repoPath required for push')
      logger.info('[executor] Pushing to origin')
      try {
        await execFile('git', ['push', 'origin', 'HEAD'], { cwd: op.repoPath, env })
        logger.info('[executor] Push succeeded')
      } catch (pushErr) {
        throw new Error(
          `Push failed: ${getErrorMessage(pushErr)}. The squash commit is on local main but hasn't reached origin. The worktree is preserved and the task remains in review so you can retry.`
        )
      }
      return state
    }

    // ========================================================================
    // cleanup
    // ========================================================================
    case 'cleanup': {
      if (!state.branch) throw new Error('branch not set in state (getBranch must run first)')
      if (!op.worktreePath) throw new Error('worktreePath required for cleanup')
      if (!op.repoPath) throw new Error('repoPath required for cleanup')
      await cleanupWorktree(op.worktreePath, state.branch, op.repoPath, env)
      return state
    }

    // ========================================================================
    // scratchpadCleanup
    // ========================================================================
    case 'scratchpadCleanup': {
      if (!op.taskId) throw new Error('taskId required for scratchpadCleanup')
      try {
        rmSync(join(BDE_TASK_MEMORY_DIR, op.taskId), { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
      return state
    }

    default:
      throw new Error(`Unknown git operation type: ${(op as GitOpDescriptor).type}`)
  }
}

// ============================================================================
// Main Executor
// ============================================================================

/**
 * Execute a review action plan.
 *
 * Runs git operations in order, applies task patches, broadcasts mutations,
 * and triggers terminal callbacks as described by the plan.
 *
 * Throws on any git operation failure. The caller is responsible for catching
 * and classifying errors.
 *
 * @returns The executor state (branch, baseSha, conflicts, cssWarnings) after all operations complete.
 */
export async function executeReviewAction(
  plan: ReviewActionPlan,
  taskId: string,
  deps: ReviewActionDeps
): Promise<ExecutorState> {
  const { repo, broadcast, onStatusTerminal } = deps

  let state: ExecutorState = {}

  // Run git operations in order
  for (const op of plan.gitOps) {
    state = await executeGitOp(op, state, deps)
  }

  // Apply CSS warnings to task notes if present
  if (state.cssWarnings?.length && plan.taskPatch) {
    const existing = repo.getTask(taskId)
    const warnText = `\n\n## CSS Near-Duplicate Warnings\n${state.cssWarnings.join('\n')}`
    plan.taskPatch.notes = (existing?.notes || '') + warnText
  }

  // Apply task patch
  if (plan.taskPatch) {
    const updated = repo.updateTask(taskId, plan.taskPatch)
    if (updated) broadcast('sprint:mutation', { type: 'updated', task: updated })
  }

  // Trigger terminal callback
  if (plan.terminalStatus) {
    await onStatusTerminal(taskId, plan.terminalStatus)
  }

  return state
}
