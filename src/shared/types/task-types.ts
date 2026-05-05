/**
 * Task and sprint-related types — task definitions, dependencies, templates, and operations.
 */

import type { TaskStatus } from '../task-state-machine'

export type { TaskStatus }

export interface TaskDependency {
  id: string
  type: 'hard' | 'soft'
  /**
   * Condition under which this dependency unblocks the downstream task.
   * - `on_success`: unblocks when upstream reaches `done`
   * - `on_failure`: unblocks when upstream reaches a failure status
   * - `always`: unblocks when upstream reaches any terminal status
   *
   * REQUIRED in a future version. Currently optional for backward compatibility;
   * omitting it triggers a deprecation warning and falls back to `type`-based behavior.
   */
  condition?: 'on_success' | 'on_failure' | 'always' | undefined
}

export interface EpicDependency {
  id: string
  condition: 'on_success' | 'always' | 'manual'
}

export interface TaskGroup {
  id: string
  name: string
  icon: string
  accent_color: string
  goal: string | null
  status: 'draft' | 'ready' | 'in-pipeline' | 'completed'
  created_at: string
  updated_at: string
  depends_on: EpicDependency[] | null
  /** When true, the drain loop will not claim any of this epic's queued tasks. */
  is_paused: boolean
}

export interface RevisionFeedbackEntry {
  timestamp: string
  feedback: string
  attempt: number
}

export interface VerificationRecord {
  exitCode: number
  stdout: string
  stderr: string
  /** true when stdout or stderr was truncated to VERIFICATION_OUTPUT_CAP chars */
  truncated: boolean
  durationMs: number
  timestamp: string // ISO-8601
}

export interface VerificationResults {
  /** null when the repo has no typecheck script */
  typecheck: VerificationRecord | null
  /** null when typecheck failed (gate short-circuits) or repo has no test script */
  tests: VerificationRecord | null
}

export function isVerificationResults(v: unknown): v is VerificationResults {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return 'typecheck' in r && 'tests' in r
}

export type FailureReason =
  | 'auth'
  | 'timeout'
  | 'test_failure'
  | 'compilation'
  | 'spawn'
  | 'no_commits'
  | 'no-commits-exhausted'
  | 'tip-mismatch'
  | 'incomplete_files'
  | 'environmental'
  | 'git-precondition-failed'
  | 'unknown'

export interface SprintTask {
  id: string
  title: string
  repo: string
  prompt: string | null
  priority: number
  status: TaskStatus
  notes: string | null
  spec: string | null
  retry_count: number
  fast_fail_count: number
  agent_run_id: string | null
  pr_number: number | null
  pr_status: 'open' | 'merged' | 'closed' | 'draft' | 'branch_only' | null
  pr_mergeable_state?:
    | 'clean'
    | 'dirty'
    | 'blocked'
    | 'behind'
    | 'unstable'
    | 'unknown'
    | null
    | undefined
  pr_url: string | null
  /**
   * When this task is part of a PR Group, the id of the task whose worktree
   * branch this task's commits are stacked on top of. Null for the first
   * task in a group, or for tasks not yet assigned to a group.
   */
  stacked_on_task_id: string | null
  claimed_by: string | null
  started_at: string | null
  completed_at: string | null
  template_name: string | null
  depends_on: TaskDependency[] | null
  playground_enabled?: boolean
  max_runtime_ms?: number | null
  duration_ms?: number | null
  spec_type?: string | null
  needs_review?: boolean
  worktree_path?: string | null
  session_id?: string | null
  next_eligible_at?: string | null
  model?: string | null
  retry_context?: string | null
  failure_reason?: 'auth' | 'timeout' | 'test_failure' | 'compilation' | 'spawn' | 'unknown' | null
  max_cost_usd?: number | null
  partial_diff?: string | null
  tags?: string[] | null
  group_id?: string | null
  sprint_id?: string | null
  cross_repo_contract?: string | null
  rebase_base_sha?: string | null
  rebased_at?: string | null
  /**
   * Audit trail of revision requests — appended each time a reviewer clicks
   * "Request Revision" in the Code Review station. Shown as a collapsible
   * "Previous revision requests" section when reviewing a retry attempt.
   */
  revision_feedback?: RevisionFeedbackEntry[] | null
  /**
   * Serialized JSON snapshot of the diff captured at review transition,
   * so Code Review can still show changes after the worktree is cleaned up.
   * Shape: { capturedAt: string; branchTip?: string;
   *          totals: { additions, deletions, files };
   *          files: Array<{ path; status; additions; deletions; patch? }>;
   *          truncated?: boolean }
   */
  review_diff_snapshot?: string | null
  /**
   * ISO8601 timestamp when the task entered `review` status. Written by both
   * review-transition paths (pipeline agent completion and adhoc promotion)
   * so the Code Review nav badge can watermark "new since you last looked."
   */
  promoted_to_review_at?: string | null
  /**
   * Number of times this task has been rescued by orphan recovery.
   * When this reaches MAX_ORPHAN_RECOVERY_COUNT the task is transitioned
   * to `error` instead of being re-queued, preventing infinite crash loops.
   */
  orphan_recovery_count?: number
  /**
   * The exact prompt text rendered and passed to the SDK on the task's most
   * recent run. Persisted immediately before spawn so spec authors can inspect
   * what the agent actually received.
   */
  last_rendered_prompt?: string | null
  verification_results?: VerificationResults | null
  updated_at: string
  created_at: string
}

// ---------------------------------------------------------------------------
// SprintTask view types — focused Pick subsets for consumers that don't need
// the full 43-field shape. SprintTask satisfies all four structurally.
// ---------------------------------------------------------------------------

/** Always meaningful regardless of task status. Every consumer can use this. */
export type SprintTaskCore = Pick<
  SprintTask,
  | 'id'
  | 'title'
  | 'repo'
  | 'status'
  | 'priority'
  | 'notes'
  | 'tags'
  | 'group_id'
  | 'sprint_id'
  | 'created_at'
  | 'updated_at'
>

/** Task definition fields — workbench, spec drafting, prompt building. */
export type SprintTaskSpec = SprintTaskCore &
  Pick<
    SprintTask,
    | 'prompt'
    | 'spec'
    | 'spec_type'
    | 'template_name'
    | 'needs_review'
    | 'playground_enabled'
    | 'depends_on'
    | 'cross_repo_contract'
    | 'max_cost_usd'
    | 'max_runtime_ms'
    | 'model'
  >

/** Agent runtime state — drain loop, watchdog, completion handler. */
export type SprintTaskExecution = SprintTaskCore &
  Pick<
    SprintTask,
    | 'claimed_by'
    | 'agent_run_id'
    | 'started_at'
    | 'completed_at'
    | 'retry_count'
    | 'fast_fail_count'
    | 'retry_context'
    | 'next_eligible_at'
    | 'session_id'
    | 'duration_ms'
    | 'worktree_path'
    | 'rebase_base_sha'
    | 'rebased_at'
    | 'failure_reason'
    | 'partial_diff'
  >

/** PR and review lifecycle — code review station, sprint PR poller. */
export type SprintTaskPR = SprintTaskCore &
  Pick<
    SprintTask,
    | 'pr_url'
    | 'pr_number'
    | 'pr_status'
    | 'pr_mergeable_state'
    | 'stacked_on_task_id'
    | 'revision_feedback'
    | 'review_diff_snapshot'
    | 'promoted_to_review_at'
  >

/** Shape of the `review_diff_snapshot` JSON blob. */
export interface ReviewDiffSnapshot {
  capturedAt: string
  /**
   * Git SHA of HEAD in the agent worktree when the snapshot was captured.
   * Used by Code Review to compute an incremental "since last review" diff
   * by calling `git diff <branchTip>..HEAD` after a revision cycle.
   */
  branchTip?: string
  totals: { additions: number; deletions: number; files: number }
  files: Array<{
    path: string
    status: 'A' | 'M' | 'D' | 'R' | string
    additions: number
    deletions: number
    /** Raw unified diff for this file. Omitted when truncated. */
    patch?: string
  }>
  /** True if per-file patches were dropped because the diff was too large. */
  truncated?: boolean
}

/** Task template — named prompt prefix resolved at claim time. */
export interface Sprint {
  id: string
  name: string
  goal: string | null
  start_date: string
  end_date: string
  status: 'planning' | 'active' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
}

export interface TaskTemplate {
  name: string
  promptPrefix: string
  isBuiltIn?: boolean | undefined
}

/**
 * Input shape for `sprint:batchImport`.
 *
 * Single source of truth — IPC channel definition, the IPC handler, the
 * preload API, and the service-side `batchImportTasks` all import from
 * here. Defining the shape four times invited drift; in particular,
 * `dependsOnIndices?: number[]` and `dependsOnIndices?: number[] | undefined`
 * are distinct types under `exactOptionalPropertyTypes: true`, and the
 * mismatch caused subtle typecheck failures whose error messages didn't
 * point at the divergence.
 *
 * Optionality style: bare `?:` (no `| undefined`). Callers should omit the
 * property when not needed, not pass an explicit `undefined`.
 */
export interface BatchImportTask {
  title: string
  repo: string
  prompt?: string
  spec?: string
  status?: string
  dependsOnIndices?: number[]
  depType?: 'hard' | 'soft'
  playgroundEnabled?: boolean
  model?: string
  tags?: string[]
  priority?: number
  templateName?: string
}

/** A claimed task with an optional template prompt prefix. */
export interface ClaimedTask extends SprintTask {
  templatePromptPrefix: string | null
}

/**
 * A PR Group collects multiple approved tasks into a single stacked PR.
 * Tasks in the group are squash-merged in `task_order` sequence onto a
 * shared branch, then pushed as one pull request.
 */
export interface PrGroup {
  id: string
  repo: string
  title: string
  branch_name: string
  description: string | null
  status: 'composing' | 'building' | 'open' | 'merged'
  task_order: string[]
  pr_number: number | null
  pr_url: string | null
  created_at: string
  updated_at: string
}

// --- Spec Synthesizer ---

export interface SynthesizeRequest {
  templateId: string | null
  templateName: string
  answers: Record<string, string>
  repo: string
  repoPath: string
  customPrompt?: string
}

export interface ReviseRequest {
  currentSpec: string
  instruction: string
  stepIndex?: number
  repo: string
  repoPath: string
}

// --- Batch Operation Types ---

export interface BatchOperation {
  op: 'update' | 'delete'
  id: string
  patch?: Record<string, unknown> | undefined
}

export interface BatchResult {
  id: string
  op: 'update' | 'delete'
  ok: boolean
  error?: string | undefined
}

/**
 * Narrows the `sprint:update` patch argument to the fields an IPC caller may
 * set. Mirrors `GENERAL_PATCH_FIELDS` but expressed as a type so channel
 * definitions and call sites get static checking instead of a runtime filter.
 */
export type SprintTaskPatch = Partial<
  Pick<
    SprintTask,
    | 'title'
    | 'prompt'
    | 'repo'
    | 'spec'
    | 'notes'
    | 'priority'
    | 'template_name'
    | 'playground_enabled'
    | 'max_runtime_ms'
    | 'model'
    | 'max_cost_usd'
  >
>

// Field allowlist for general task updates
export const GENERAL_PATCH_FIELDS = new Set([
  'title',
  'prompt',
  'repo',
  'spec',
  'notes',
  'priority',
  'templateName',
  'playgroundEnabled',
  'maxRuntimeMs',
  'model',
  'maxCostUsd'
])

// --- Task Output Event Types ---

export type TaskOutputEventType =
  | 'agent:started'
  | 'agent:tool_call'
  | 'agent:tool_result'
  | 'agent:thinking'
  | 'agent:rate_limited'
  | 'agent:error'
  | 'agent:completed'

export interface TaskOutputEvent {
  taskId: string
  timestamp: string
  type: TaskOutputEventType | string
}

// --- Auto-Review Rules ---

export interface AutoReviewRule {
  id: string
  name: string
  enabled: boolean
  conditions: {
    maxLinesChanged?: number
    filePatterns?: string[] // glob patterns — all changed files must match at least one
    excludePatterns?: string[] // glob patterns — no changed files may match any
  }
  action: 'auto-merge' | 'auto-approve'
}

// --- Success Rate by Spec Type ---

export interface SpecTypeSuccessRate {
  spec_type: string | null
  done: number
  total: number
  success_rate: number
}

// --- Lightweight result type for expected failures ---

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
