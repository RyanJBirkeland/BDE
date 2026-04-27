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
import { nowIso } from '../../shared/time'

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

type ReviewActionBuilder = (input: ReviewActionInput) => ReviewActionPlan

const PLAN_BUILDERS: Record<ReviewActionInput['action'], ReviewActionBuilder> = {
  requestRevision: buildRequestRevisionPlan,
  discard: buildDiscardPlan,
  mergeLocally: buildMergeLocallyPlan,
  createPr: buildCreatePrPlan,
  shipIt: buildShipItPlan,
  rebase: buildRebasePlan,
  markFailed: buildMarkFailedPlan
}

/**
 * Classify a review action into an execution plan.
 *
 * Pure function — no I/O, no side effects. Each action has a dedicated builder
 * that contains only the logic for that action; this dispatcher selects the
 * builder by `input.action`.
 */
export function classifyReviewAction(input: ReviewActionInput): ReviewActionPlan {
  const builder = PLAN_BUILDERS[input.action]
  if (!builder) throw new Error(`Unknown action: ${input.action}`)
  return builder(input)
}

function buildRequestRevisionPlan(input: ReviewActionInput): ReviewActionPlan {
  const { task, feedback, revisionMode } = input
  if (!feedback) throw new Error('feedback required for requestRevision')

  const patch: Record<string, unknown> = {
    status: 'queued',
    claimed_by: null,
    notes: `[Revision requested]: ${feedback}`,
    started_at: null,
    completed_at: null,
    fast_fail_count: 0,
    needs_review: false,
    spec: task.spec ? `${task.spec}\n\n## Revision Feedback\n\n${feedback}` : feedback
  }
  // Fresh mode: clear agent_run_id to start a new session.
  if (revisionMode === 'fresh') patch.agent_run_id = null

  return {
    gitOps: [],
    taskPatch: patch,
    terminalStatus: null,
    errorOnMissingWorktree: false,
    dedup: false
  }
}

function buildDiscardPlan(input: ReviewActionInput): ReviewActionPlan {
  return {
    gitOps: buildWorktreeCleanupOps(input),
    taskPatch: {
      status: 'cancelled',
      completed_at: nowIso(),
      worktree_path: null
    },
    terminalStatus: 'cancelled',
    errorOnMissingWorktree: false,
    dedup: false
  }
}

function buildMergeLocallyPlan(input: ReviewActionInput): ReviewActionPlan {
  const { task, taskId, repoConfig, strategy } = input
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
    taskPatch: doneStatusPatch(),
    terminalStatus: 'done',
    errorOnMissingWorktree: true,
    dedup: true
  }
}

function buildCreatePrPlan(input: ReviewActionInput): ReviewActionPlan {
  const { task, taskId, prTitle, prBody } = input
  if (!prTitle) throw new Error('prTitle required for createPr')
  if (!prBody) throw new Error('prBody required for createPr')
  if (!task.worktree_path) throw new Error(`Task ${taskId} has no worktree path`)

  return {
    // Push and PR creation handled by review-orchestration-service.createPr directly
    // (not via runPlan). The task stays in `review` after PR creation — the sprint
    // PR poller marks it done when GitHub reports the PR as merged.
    gitOps: [{ type: 'getBranch', worktreePath: task.worktree_path }],
    taskPatch: { worktree_path: null },
    terminalStatus: null,
    errorOnMissingWorktree: true,
    dedup: false
  }
}

function buildShipItPlan(input: ReviewActionInput): ReviewActionPlan {
  const { task, taskId, repoConfig, strategy } = input
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
    taskPatch: doneStatusPatch(),
    terminalStatus: 'done',
    errorOnMissingWorktree: true,
    dedup: true
  }
}

function buildRebasePlan(input: ReviewActionInput): ReviewActionPlan {
  if (!input.task.worktree_path) throw new Error(`Task ${input.taskId} has no worktree path`)
  return {
    gitOps: [{ type: 'rebase', worktreePath: input.task.worktree_path }],
    // baseSha is set by the executor after rebase succeeds.
    taskPatch: null,
    terminalStatus: null,
    errorOnMissingWorktree: true,
    dedup: false
  }
}

function buildMarkFailedPlan(input: ReviewActionInput): ReviewActionPlan {
  return {
    gitOps: buildWorktreeCleanupOps(input),
    taskPatch: {
      status: 'failed',
      failure_reason: input.feedback ?? 'Marked as permanently failed during review',
      completed_at: nowIso(),
      worktree_path: null
    },
    terminalStatus: 'failed',
    errorOnMissingWorktree: false,
    dedup: false
  }
}

/** Cleanup ops shared by `discard` and `markFailed`. */
function buildWorktreeCleanupOps(input: ReviewActionInput): GitOpDescriptor[] {
  const ops: GitOpDescriptor[] = []
  if (input.task.worktree_path) {
    ops.push(
      { type: 'getBranch', worktreePath: input.task.worktree_path },
      {
        type: 'cleanup',
        worktreePath: input.task.worktree_path,
        repoPath: input.repoConfig?.localPath
      }
    )
  }
  ops.push({ type: 'scratchpadCleanup', taskId: input.taskId })
  return ops
}

function doneStatusPatch(): Record<string, unknown> {
  return {
    status: 'done',
    completed_at: nowIso(),
    worktree_path: null
  }
}
