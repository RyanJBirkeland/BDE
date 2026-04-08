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
  entries: Array<{ taskId: string; oldTask: Record<string, unknown>; newPatch: Record<string, unknown> }>,
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

/**
 * Get change history for a task, most recent first.
 */
export function getTaskChanges(
  taskId: string,
  limit: number = 50,
  db?: Database.Database
): TaskChange[] {
  const conn = db ?? getDb()
  return conn
    .prepare(
      `SELECT id, task_id, field, old_value, new_value, changed_by, changed_at
       FROM task_changes WHERE task_id = ? ORDER BY changed_at DESC LIMIT ?`
    )
    .all(taskId, limit) as TaskChange[]
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
