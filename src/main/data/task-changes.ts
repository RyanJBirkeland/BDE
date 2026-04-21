import { getDb } from '../db'
import type Database from 'better-sqlite3'

export interface TaskChange {
  id: number
  task_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_at: string
}

/**
 * Record field-level changes for a task.
 * Compares old and new values, only records actual changes.
 * DL-20: Wraps in transaction if db not provided (transactional for multi-field patches).
 */
export function recordTaskChanges(
  taskId: string,
  oldTask: Record<string, unknown>,
  newPatch: Record<string, unknown>,
  changedBy: string = 'unknown',
  db?: Database.Database
): void {
  const conn = db ?? getDb()

  const recordChanges = (): void => {
    const stmt = conn.prepare(
      'INSERT INTO task_changes (task_id, field, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?)'
    )

    for (const [field, newValue] of Object.entries(newPatch)) {
      const oldValue = oldTask[field]
      // Stringify for comparison (handles objects like depends_on)
      const oldStr = oldValue != null ? JSON.stringify(oldValue) : null
      const newStr = newValue != null ? JSON.stringify(newValue) : null

      // Only record actual changes
      if (oldStr !== newStr) {
        stmt.run(taskId, field, oldStr, newStr, changedBy)
      }
    }
  }

  // DL-20: If db was provided, caller is responsible for transaction.
  // Otherwise, wrap in our own transaction for atomicity.
  if (db) {
    recordChanges()
  } else {
    conn.transaction(recordChanges)()
  }
}

/**
 * F-t3-db-4: Bulk variant for callers that record changes for many tasks
 * with the same patch shape (e.g. PR poller marking N tasks done at once).
 *
 * Prepares the INSERT statement once and reuses it across all entries,
 * eliminating per-iteration prepare overhead. Caller is responsible for
 * the surrounding transaction.
 */
export function recordTaskChangesBulk(
  entries: Array<{
    taskId: string
    oldTask: Record<string, unknown>
    newPatch: Record<string, unknown>
  }>,
  changedBy: string,
  db: Database.Database
): void {
  if (entries.length === 0) return

  const stmt = db.prepare(
    'INSERT INTO task_changes (task_id, field, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?)'
  )

  for (const { taskId, oldTask, newPatch } of entries) {
    for (const [field, newValue] of Object.entries(newPatch)) {
      const oldValue = oldTask[field]
      const oldStr = oldValue != null ? JSON.stringify(oldValue) : null
      const newStr = newValue != null ? JSON.stringify(newValue) : null
      if (oldStr !== newStr) {
        stmt.run(taskId, field, oldStr, newStr, changedBy)
      }
    }
  }
}

export interface GetTaskChangesOptions {
  /** Maximum rows to return (default 50). */
  limit?: number | undefined
  /** Rows to skip before the returned page (default 0). */
  offset?: number | undefined
}

const DEFAULT_HISTORY_LIMIT = 50

/**
 * Get change history for a task, most recent first.
 *
 * Accepts either a bare numeric limit (legacy signature) or an options
 * object so the pagination is pushed into SQL (`LIMIT ? OFFSET ?`)
 * instead of being implemented as `fetch(limit+offset).slice(offset)`
 * at the call site. Unbounded offsets are rejected upstream by the
 * MCP schema cap.
 */
export function getTaskChanges(
  taskId: string,
  limitOrOptions?: number | GetTaskChangesOptions,
  db?: Database.Database
): TaskChange[] {
  const { limit, offset } = normalizeHistoryOptions(limitOrOptions)
  const conn = db ?? getDb()
  return conn
    .prepare(
      `SELECT id, task_id, field, old_value, new_value, changed_by, changed_at
       FROM task_changes WHERE task_id = ? ORDER BY changed_at DESC LIMIT ? OFFSET ?`
    )
    .all(taskId, limit, offset) as TaskChange[]
}

function normalizeHistoryOptions(limitOrOptions: number | GetTaskChangesOptions | undefined): {
  limit: number
  offset: number
} {
  if (typeof limitOrOptions === 'number') {
    return { limit: limitOrOptions, offset: 0 }
  }
  return {
    limit: limitOrOptions?.limit ?? DEFAULT_HISTORY_LIMIT,
    offset: limitOrOptions?.offset ?? 0
  }
}

/**
 * Prune old change records (keep last 30 days).
 */
export function pruneOldChanges(daysToKeep: number = 30, db?: Database.Database): number {
  const conn = db ?? getDb()
  const cutoff = new Date(Date.now() - daysToKeep * 86400000).toISOString()
  const result = conn.prepare('DELETE FROM task_changes WHERE changed_at < ?').run(cutoff)
  return result.changes
}
