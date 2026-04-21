import type { SprintTask } from '../../shared/types'
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

function parseRevisionFeedback(value: unknown): unknown {
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
    ...row,
    id: validateId(row.id),
    title: validateTitle(row.title),
    repo: validateRepo(row.repo),
    status: validateStatus(row.status),
    priority: validatePriority(row.priority),
    depends_on: sanitizeDependsOn(row.depends_on),
    tags: sanitizeTags(row.tags),
    playground_enabled: !!row.playground_enabled,
    needs_review: !!row.needs_review,
    revision_feedback: parseRevisionFeedback(row.revision_feedback)
  } as SprintTask
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
