/**
 * Review action policy — pure business logic for review actions.
 *
 * This module contains zero I/O. It takes inputs and produces a plan describing
 * what git operations to perform, what task state patch to apply, and which
 * terminal callback to invoke. The executor in review-action-executor.ts is
 * responsible for executing the plan.
 *
 * All functions are pure (same inputs → same outputs) and unit-testable without
 * mocking child_process or any I/O modules.
 */

import type { SprintTask } from '../../shared/types/task-types'

// ============================================================================
// Git Operation Descriptors
// ============================================================================

export type GitOpType =
  | 'getBranch'
  | 'checkStatus'
  | 'checkBranch'
  | 'fetch'
  | 'fastForward'
  | 'rebase'
  | 'merge'
  | 'push'
  | 'cleanup'
  | 'scratchpadCleanup'
  | 'cssDedup'

export interface GitOpDescriptor {
  type: GitOpType
  worktreePath?: string | undefined
  repoPath?: string | undefined
  branch?: string | undefined
  strategy?: 'merge' | 'squash' | 'rebase' | undefined
  taskId?: string | undefined
  taskTitle?: string | undefined
}

// ============================================================================
// Input Types
// ============================================================================

export interface ReviewActionInput {
  action:
    | 'mergeLocally'
    | 'createPr'
    | 'requestRevision'
    | 'discard'
    | 'shipIt'
    | 'rebase'
    | 'markFailed'
  taskId: string
  task: Pick<
    SprintTask,
    'id' | 'title' | 'repo' | 'worktree_path' | 'spec' | 'notes' | 'agent_run_id'
  >
  repoConfig: { localPath: string; githubOwner?: string; githubRepo?: string } | null
  // Action-specific fields
  strategy?: 'merge' | 'squash' | 'rebase'
  prTitle?: string
  prBody?: string
  feedback?: string
  revisionMode?: 'resume' | 'fresh'
}

// ============================================================================
// Plan Types
// ============================================================================

export interface ReviewActionPlan {
  /**
   * Ordered list of git operations to perform.
   * The executor runs these sequentially and stops on first error.
   */
  gitOps: GitOpDescriptor[]
  /**
   * Task state patch to apply after git operations succeed.
   * null = no update needed.
   */
  taskPatch: Record<string, unknown> | null
  /**
   * Terminal status to trigger dependency resolution.
   * null = no terminal callback.
   */
  terminalStatus: 'done' | 'cancelled' | 'failed' | null
  /**
   * If true, throw if worktree_path is missing.
   * Used by actions that require a worktree.
   */
  errorOnMissingWorktree: boolean
  /**
   * Run post-merge CSS dedup analysis.
   */
  dedup: boolean
}

// ============================================================================
// Policy Function
// ============================================================================

/**
 * Classify a review action into an execution plan.
 *
 * This is a pure function — no I/O, no side effects. Takes inputs describing
 * the action and task state, returns a plan describing what to do.
 *
 * The executor (review-action-executor.ts) is responsible for running the plan.
 */
export function classifyReviewAction(input: ReviewActionInput): ReviewActionPlan {
  const { action, task, taskId, repoConfig, strategy, prTitle, prBody, feedback, revisionMode } =
    input

  // ============================================================================
  // requestRevision
  // ============================================================================
  if (action === 'requestRevision') {
    if (!feedback) throw new Error('feedback required for requestRevision')

    const revisionNotes = `[Revision requested]: ${feedback}`
    const patch: Record<string, unknown> = {
      status: 'queued',
      claimed_by: null,
      notes: revisionNotes,
      started_at: null,
      completed_at: null,
      fast_fail_count: 0,
      needs_review: false,
      spec: task.spec ? `${task.spec}\n\n## Revision Feedback\n\n${feedback}` : feedback
    }

    // Fresh mode: clear agent_run_id to start a new session
    if (revisionMode === 'fresh') {
      patch.agent_run_id = null
    }

    return {
      gitOps: [],
      taskPatch: patch,
      terminalStatus: null,
      errorOnMissingWorktree: false,
      dedup: false
    }
  }

  // ============================================================================
  // discard
  // ============================================================================
  if (action === 'discard') {
    const gitOps: GitOpDescriptor[] = []

    // If worktree exists, clean it up
    if (task.worktree_path) {
      gitOps.push(
        { type: 'getBranch', worktreePath: task.worktree_path },
        {
          type: 'cleanup',
          worktreePath: task.worktree_path,
          repoPath: repoConfig?.localPath
        }
      )
    }

    // Always clean scratchpad
    gitOps.push({ type: 'scratchpadCleanup', taskId })

    return {
      gitOps,
      taskPatch: {
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        worktree_path: null
      },
      terminalStatus: 'cancelled',
      errorOnMissingWorktree: false,
      dedup: false
    }
  }

  // ============================================================================
  // mergeLocally
  // ============================================================================
  if (action === 'mergeLocally') {
    if (!strategy) throw new Error('strategy required for mergeLocally')
    if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)
    if (!repoConfig) throw new Error(`Repo "${task.repo}" not found in settings`)

    return {
      gitOps: [
        { type: 'getBranch', worktreePath: task.worktree_path },
        {
          type: 'merge',
          worktreePath: task.worktree_path,
          repoPath: repoConfig.localPath,
          strategy,
          taskId,
          taskTitle: task.title
        },
        { type: 'cssDedup', repoPath: repoConfig.localPath, taskId },
        {
          type: 'cleanup',
          worktreePath: task.worktree_path,
          repoPath: repoConfig.localPath
        }
      ],
      taskPatch: {
        status: 'done',
        completed_at: new Date().toISOString(),
        worktree_path: null
      },
      terminalStatus: 'done',
      errorOnMissingWorktree: true,
      dedup: true
    }
  }

  // ============================================================================
  // createPr
  // ============================================================================
  if (action === 'createPr') {
    if (!prTitle) throw new Error('prTitle required for createPr')
    if (!prBody) throw new Error('prBody required for createPr')
    if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)

    return {
      gitOps: [
        { type: 'getBranch', worktreePath: task.worktree_path }
        // Push and PR creation handled by review-pr-service (already extracted)
      ],
      taskPatch: {
        status: 'done',
        completed_at: new Date().toISOString(),
        worktree_path: null
      },
      terminalStatus: 'done',
      errorOnMissingWorktree: true,
      dedup: false
    }
  }

  // ============================================================================
  // shipIt
  // ============================================================================
  if (action === 'shipIt') {
    if (!strategy) throw new Error('strategy required for shipIt')
    if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)
    if (!repoConfig) throw new Error(`Repo "${task.repo}" not found in settings`)

    return {
      gitOps: [
        { type: 'getBranch', worktreePath: task.worktree_path },
        { type: 'checkStatus', repoPath: repoConfig.localPath },
        { type: 'checkBranch', repoPath: repoConfig.localPath },
        { type: 'fetch', repoPath: repoConfig.localPath },
        { type: 'fastForward', repoPath: repoConfig.localPath },
        { type: 'rebase', worktreePath: task.worktree_path },
        {
          type: 'merge',
          repoPath: repoConfig.localPath,
          strategy,
          taskId,
          taskTitle: task.title
        },
        { type: 'cssDedup', repoPath: repoConfig.localPath, taskId },
        { type: 'push', repoPath: repoConfig.localPath },
        {
          type: 'cleanup',
          worktreePath: task.worktree_path,
          repoPath: repoConfig.localPath
        }
      ],
      taskPatch: {
        status: 'done',
        completed_at: new Date().toISOString(),
        worktree_path: null
      },
      terminalStatus: 'done',
      errorOnMissingWorktree: true,
      dedup: true
    }
  }

  // ============================================================================
  // rebase
  // ============================================================================
  if (action === 'rebase') {
    if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)

    return {
      gitOps: [{ type: 'rebase', worktreePath: task.worktree_path }],
      taskPatch: null, // baseSha is set by executor after rebase succeeds
      terminalStatus: null,
      errorOnMissingWorktree: true,
      dedup: false
    }
  }

  // ============================================================================
  // markFailed
  // ============================================================================
  if (action === 'markFailed') {
    const gitOps: GitOpDescriptor[] = []

    // If worktree exists, clean it up
    if (task.worktree_path) {
      gitOps.push(
        { type: 'getBranch', worktreePath: task.worktree_path },
        {
          type: 'cleanup',
          worktreePath: task.worktree_path,
          repoPath: repoConfig?.localPath
        }
      )
    }

    // Always clean scratchpad
    gitOps.push({ type: 'scratchpadCleanup', taskId })

    return {
      gitOps,
      taskPatch: {
        status: 'failed',
        failure_reason: feedback ?? 'Marked as permanently failed during review',
        completed_at: new Date().toISOString(),
        worktree_path: null
      },
      terminalStatus: 'failed',
      errorOnMissingWorktree: false,
      dedup: false
    }
  }

  throw new Error(`Unknown action: ${action}`)
}
