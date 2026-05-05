import type { SprintTask, RevisionFeedbackEntry, FailureReason } from '../../shared/types'
import { isVerificationResults } from '../../shared/types/task-types'
import { sanitizeDependsOn } from '../../shared/sanitize-depends-on'
import { sanitizeTags } from '../../shared/sanitize-tags'
import { TASK_STATUSES } from '../../shared/task-state-machine'
import { getSprintQueriesLogger } from './sprint-query-logger'

const VALID_STATUSES: ReadonlySet<string> = new Set(TASK_STATUSES)

function describeInvalidValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return `"${value}"`
  return String(value)
}

function validateId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Invalid sprint_tasks row: id must be a non-empty string, got ${describeInvalidValue(value)}`
    )
  }
  return value
}

function validateStatus(value: unknown): SprintTask['status'] {
  if (typeof value !== 'string' || !VALID_STATUSES.has(value)) {
    throw new Error(
      `Invalid sprint_tasks row: status must be one of [${TASK_STATUSES.join(', ')}], got ${describeInvalidValue(value)}`
    )
  }
  return value as SprintTask['status']
}

function validatePriority(value: unknown): number {
  const coerced = Number(value)
  if (!Number.isFinite(coerced)) {
    throw new Error(
      `Invalid sprint_tasks row: priority must be a finite number, got ${describeInvalidValue(value)}`
    )
  }
  return coerced
}

function validateRepo(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Invalid sprint_tasks row: repo must be a non-empty string, got ${describeInvalidValue(value)}`
    )
  }
  return value
}

function validateTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(
      `Invalid sprint_tasks row: title must be a string, got ${describeInvalidValue(value)}`
    )
  }
  return value
}

const VALID_PR_STATUSES: ReadonlySet<string> = new Set([
  'open',
  'merged',
  'closed',
  'draft',
  'branch_only'
])
const VALID_MERGEABLE_STATES: ReadonlySet<string> = new Set([
  'clean',
  'dirty',
  'blocked',
  'behind',
  'unstable',
  'unknown'
])
const VALID_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'auth',
  'timeout',
  'test_failure',
  'compilation',
  'spawn',
  'no_commits',
  'no-commits-exhausted',
  'tip-mismatch',
  'incomplete_files',
  'environmental',
  'git-precondition-failed',
  'unknown'
] satisfies FailureReason[])

function toOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toOptionalInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
}

function toOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nullableUnion<T extends string>(value: unknown, validSet: ReadonlySet<string>): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && validSet.has(value)) return value as T
  return null
}

function isRevisionFeedbackEntry(item: unknown): item is RevisionFeedbackEntry {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as Record<string, unknown>).timestamp === 'string' &&
    typeof (item as Record<string, unknown>).feedback === 'string'
  )
}

function parseRevisionFeedback(value: unknown): RevisionFeedbackEntry[] | null {
  let parsed: unknown = value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = null
    }
  }
  if (!Array.isArray(parsed)) return null
  const validEntries = parsed.filter(isRevisionFeedbackEntry)
  if (validEntries.length < parsed.length) {
    getSprintQueriesLogger().warn(
      `[sprint-task-mapper] parseRevisionFeedback: filtered out ${parsed.length - validEntries.length} malformed entries`
    )
  }
  return validEntries
}

function parseVerificationResults(
  value: unknown
): import('../../shared/types/task-types').VerificationResults | null {
  let parsed: unknown = value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return null
    }
  }
  if (!isVerificationResults(parsed)) return null
  return parsed
}

/**
 * Sanitize a single task row from SQLite into a typed SprintTask.
 * Throws if the row's critical domain fields (id, status, priority, repo, title)
 * are missing or corrupted — callers decide whether to drop the row or crash.
 */
export function mapRowToTask(row: Record<string, unknown>): SprintTask {
  return {
    id: validateId(row.id),
    title: validateTitle(row.title),
    repo: validateRepo(row.repo),
    status: validateStatus(row.status),
    priority: validatePriority(row.priority),
    prompt: toOptionalString(row.prompt),
    notes: toOptionalString(row.notes),
    spec: toOptionalString(row.spec),
    retry_count: toOptionalInt(row.retry_count) ?? 0,
    fast_fail_count: toOptionalInt(row.fast_fail_count) ?? 0,
    agent_run_id: toOptionalString(row.agent_run_id),
    pr_number: toOptionalInt(row.pr_number),
    pr_status: nullableUnion<NonNullable<SprintTask['pr_status']>>(row.pr_status, VALID_PR_STATUSES),
    pr_mergeable_state: nullableUnion<NonNullable<SprintTask['pr_mergeable_state']>>(
      row.pr_mergeable_state,
      VALID_MERGEABLE_STATES
    ),
    pr_url: toOptionalString(row.pr_url),
    stacked_on_task_id: toOptionalString(row.stacked_on_task_id),
    claimed_by: toOptionalString(row.claimed_by),
    started_at: toOptionalString(row.started_at),
    completed_at: toOptionalString(row.completed_at),
    template_name: toOptionalString(row.template_name),
    depends_on: sanitizeDependsOn(row.depends_on),
    playground_enabled: !!row.playground_enabled,
    needs_review: !!row.needs_review,
    max_runtime_ms: toOptionalInt(row.max_runtime_ms),
    duration_ms: toOptionalInt(row.duration_ms),
    spec_type: toOptionalString(row.spec_type),
    worktree_path: toOptionalString(row.worktree_path),
    session_id: toOptionalString(row.session_id),
    next_eligible_at: toOptionalString(row.next_eligible_at),
    model: toOptionalString(row.model),
    retry_context: toOptionalString(row.retry_context),
    failure_reason: nullableUnion<NonNullable<SprintTask['failure_reason']>>(
      row.failure_reason,
      VALID_FAILURE_REASONS
    ),
    max_cost_usd: toOptionalNumber(row.max_cost_usd),
    partial_diff: toOptionalString(row.partial_diff),
    tags: sanitizeTags(row.tags),
    group_id: toOptionalString(row.group_id),
    sprint_id: toOptionalString(row.sprint_id),
    cross_repo_contract: toOptionalString(row.cross_repo_contract),
    rebase_base_sha: toOptionalString(row.rebase_base_sha),
    rebased_at: toOptionalString(row.rebased_at),
    revision_feedback: parseRevisionFeedback(row.revision_feedback),
    verification_results: parseVerificationResults(row.verification_results),
    review_diff_snapshot: toOptionalString(row.review_diff_snapshot),
    promoted_to_review_at: toOptionalString(row.promoted_to_review_at),
    orphan_recovery_count: toOptionalInt(row.orphan_recovery_count) ?? 0,
    updated_at: toOptionalString(row.updated_at) ?? '',
    created_at: toOptionalString(row.created_at) ?? ''
  }
}

/**
 * Sanitize an array of task rows. Invalid rows are logged and skipped so one
 * corrupted row cannot break a list query.
 */
export function mapRowsToTasks(rows: Record<string, unknown>[]): SprintTask[] {
  const tasks: SprintTask[] = []
  for (const row of rows) {
    try {
      tasks.push(mapRowToTask(row))
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      getSprintQueriesLogger().warn(`[sprint-task-mapper] Dropping corrupted row: ${reason}`)
    }
  }
  return tasks
}

/**
 * Serialize a value for SQLite storage:
 * - depends_on: JSON.stringify
 * - booleans: 1/0
 * - null prompt: ''
 */
export function serializeFieldForStorage(key: string, value: unknown): unknown {
  if (key === 'depends_on') {
    const sanitized = sanitizeDependsOn(value)
    return sanitized ? JSON.stringify(sanitized) : null
  }
  if (key === 'tags') {
    const sanitized = sanitizeTags(value)
    return sanitized ? JSON.stringify(sanitized) : null
  }
  if (key === 'revision_feedback') {
    if (value == null) return null
    if (typeof value === 'string') return value
    return JSON.stringify(value)
  }
  if (key === 'playground_enabled' || key === 'needs_review') {
    return value ? 1 : 0
  }
  if (key === 'prompt' && value == null) {
    return ''
  }
  return value
}
