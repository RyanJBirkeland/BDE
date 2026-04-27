import type { SprintTask, RevisionFeedbackEntry } from '../../shared/types'
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
  'unknown'
])

function optStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function optInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
}

function optNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nullableUnion<T extends string>(value: unknown, validSet: ReadonlySet<string>): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && validSet.has(value)) return value as T
  return null
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
    prompt: optStr(row.prompt),
    notes: optStr(row.notes),
    spec: optStr(row.spec),
    retry_count: optInt(row.retry_count) ?? 0,
    fast_fail_count: optInt(row.fast_fail_count) ?? 0,
    agent_run_id: optStr(row.agent_run_id),
    pr_number: optInt(row.pr_number),
    pr_status: nullableUnion<NonNullable<SprintTask['pr_status']>>(row.pr_status, VALID_PR_STATUSES),
    pr_mergeable_state: nullableUnion<NonNullable<SprintTask['pr_mergeable_state']>>(
      row.pr_mergeable_state,
      VALID_MERGEABLE_STATES
    ),
    pr_url: optStr(row.pr_url),
    claimed_by: optStr(row.claimed_by),
    started_at: optStr(row.started_at),
    completed_at: optStr(row.completed_at),
    template_name: optStr(row.template_name),
    depends_on: sanitizeDependsOn(row.depends_on),
    playground_enabled: !!row.playground_enabled,
    needs_review: !!row.needs_review,
    max_runtime_ms: optInt(row.max_runtime_ms),
    duration_ms: optInt(row.duration_ms),
    spec_type: optStr(row.spec_type),
    worktree_path: optStr(row.worktree_path),
    session_id: optStr(row.session_id),
    next_eligible_at: optStr(row.next_eligible_at),
    model: optStr(row.model),
    retry_context: optStr(row.retry_context),
    failure_reason: nullableUnion<NonNullable<SprintTask['failure_reason']>>(
      row.failure_reason,
      VALID_FAILURE_REASONS
    ),
    max_cost_usd: optNum(row.max_cost_usd),
    partial_diff: optStr(row.partial_diff),
    tags: sanitizeTags(row.tags),
    group_id: optStr(row.group_id),
    sprint_id: optStr(row.sprint_id),
    cross_repo_contract: optStr(row.cross_repo_contract),
    rebase_base_sha: optStr(row.rebase_base_sha),
    rebased_at: optStr(row.rebased_at),
    revision_feedback: parseRevisionFeedback(row.revision_feedback),
    review_diff_snapshot: optStr(row.review_diff_snapshot),
    orphan_recovery_count: optInt(row.orphan_recovery_count) ?? 0,
    updated_at: optStr(row.updated_at) ?? '',
    created_at: optStr(row.created_at) ?? ''
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
