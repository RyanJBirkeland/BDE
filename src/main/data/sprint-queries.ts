/**
 * Sprint task query functions — SQLite edition.
 * All functions are synchronous and use the local SQLite database via getDb().
 */
import type Database from 'better-sqlite3'
import type { SprintTask, TaskDependency } from '../../shared/types'
import { sanitizeDependsOn } from '../../shared/sanitize-depends-on'
import { getDb } from '../db'
import { recordTaskChanges } from './task-changes'
import type { Logger } from '../agent-manager/types'

// Module-level logger — defaults to console, injectable for testing/structured logging
let logger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m)
}

export function setSprintQueriesLogger(l: Logger): void {
  logger = l
}

/**
 * Sanitize a single task row from SQLite.
 * - Coerces INTEGER 0/1 to boolean for playground_enabled, needs_review
 * - Deserializes depends_on from JSON string
 */
function sanitizeTask(row: Record<string, unknown>): SprintTask {
  return {
    ...row,
    depends_on: sanitizeDependsOn(row.depends_on),
    playground_enabled: !!row.playground_enabled,
    needs_review: !!row.needs_review
  } as SprintTask
}

/**
 * Sanitize an array of task rows.
 */
function sanitizeTasks(rows: Record<string, unknown>[]): SprintTask[] {
  return rows.map(sanitizeTask)
}

// --- Field allowlist for updates ---

export const UPDATE_ALLOWLIST = new Set([
  'title',
  'prompt',
  'repo',
  'status',
  'priority',
  'spec',
  'notes',
  'pr_url',
  'pr_number',
  'pr_status',
  'pr_mergeable_state',
  'agent_run_id',
  'retry_count',
  'fast_fail_count',
  'started_at',
  'completed_at',
  'template_name',
  'claimed_by',
  'depends_on',
  'playground_enabled',
  'needs_review',
  'max_runtime_ms',
  'spec_type'
])

export interface QueueStats {
  [key: string]: number
  backlog: number
  queued: number
  active: number
  done: number
  failed: number
  cancelled: number
  error: number
  blocked: number
}

export interface CreateTaskInput {
  title: string
  repo: string
  prompt?: string
  notes?: string
  spec?: string
  priority?: number
  status?: string
  template_name?: string
  depends_on?: Array<{ id: string; type: 'hard' | 'soft' }> | null
  playground_enabled?: boolean
}

/**
 * Serialize a value for SQLite storage:
 * - depends_on: JSON.stringify
 * - booleans: 1/0
 * - null prompt: ''
 */
function serializeField(key: string, value: unknown): unknown {
  if (key === 'depends_on') {
    const sanitized = sanitizeDependsOn(value)
    return sanitized ? JSON.stringify(sanitized) : null
  }
  if (key === 'playground_enabled' || key === 'needs_review') {
    return value ? 1 : 0
  }
  if (key === 'prompt' && value == null) {
    return ''
  }
  return value
}

export function getTask(id: string, db?: Database.Database): SprintTask | null {
  try {
    const conn = db ?? getDb()
    const row = conn
      .prepare('SELECT * FROM sprint_tasks WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined
    return row ? sanitizeTask(row) : null
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function listTasks(status?: string): SprintTask[] {
  try {
    const db = getDb()
    if (status) {
      const rows = db
        .prepare(
          'SELECT * FROM sprint_tasks WHERE status = ? ORDER BY priority ASC, created_at ASC'
        )
        .all(status) as Record<string, unknown>[]
      return sanitizeTasks(rows)
    }
    const rows = db
      .prepare('SELECT * FROM sprint_tasks ORDER BY priority ASC, created_at ASC')
      .all() as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] listTasks failed: ${msg}`)
    return []
  }
}

export function createTask(input: CreateTaskInput): SprintTask | null {
  try {
    const db = getDb()
    const dependsOn = sanitizeDependsOn(input.depends_on)

    const result = db
      .prepare(
        `INSERT INTO sprint_tasks (title, repo, prompt, spec, notes, priority, status, template_name, depends_on, playground_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`
      )
      .get(
        input.title,
        input.repo,
        input.prompt ?? input.spec ?? input.title,
        input.spec ?? null,
        input.notes ?? null,
        input.priority ?? 0,
        input.status ?? 'backlog',
        input.template_name ?? null,
        dependsOn ? JSON.stringify(dependsOn) : null,
        input.playground_enabled ? 1 : 0
      ) as Record<string, unknown> | undefined

    return result ? sanitizeTask(result) : null
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] createTask failed: ${msg}`)
    return null
  }
}

export function updateTask(
  id: string,
  patch: Record<string, unknown>
): SprintTask | null {
  const entries = Object.entries(patch).filter(([k]) => UPDATE_ALLOWLIST.has(k))
  if (entries.length === 0) return null

  try {
    const db = getDb()

    // Wrap read, update, and audit in a single transaction
    return db.transaction(() => {
      // Fetch current state for change tracking
      const oldTask = getTask(id, db)
      if (!oldTask) return null

      // Build SET clause with serialized values
      const setClauses: string[] = []
      const values: unknown[] = []
      const auditPatch: Record<string, unknown> = {}

      for (const [key, value] of entries) {
        // QA-18: Defense-in-depth regex assertion for SQL column names
        if (!/^[a-z_]+$/.test(key)) {
          throw new Error(`Invalid column name: ${key}`)
        }
        setClauses.push(`${key} = ?`)
        const serialized = serializeField(key, value)
        values.push(serialized)
        // For audit, store the serialized form for depends_on but original for others
        auditPatch[key] = key === 'depends_on' ? sanitizeDependsOn(value) : value
      }

      values.push(id)

      const result = db
        .prepare(
          `UPDATE sprint_tasks SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`
        )
        .get(...values) as Record<string, unknown> | undefined

      if (!result) return null

      // Record changes for audit trail (within transaction)
      try {
        recordTaskChanges(
          id,
          oldTask as unknown as Record<string, unknown>,
          auditPatch,
          'unknown',
          db
        )
      } catch (err) {
        logger.warn(`[sprint-queries] Failed to record task changes: ${err}`)
        // Re-throw to abort transaction
        throw err
      }

      return sanitizeTask(result)
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] updateTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function deleteTask(id: string, deletedBy: string = 'unknown'): void {
  try {
    const db = getDb()
    // DL-14 & DL-18: Record deletion in audit trail before removing task (pass db for consistency)
    db.transaction(() => {
      const task = getTask(id, db)
      if (task) {
        // Record deletion event with task snapshot
        db.prepare(
          'INSERT INTO task_changes (task_id, field, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?)'
        ).run(id, '_deleted', JSON.stringify(task), null, deletedBy)
      }
      // Delete task and orphaned audit records
      db.prepare('DELETE FROM sprint_tasks WHERE id = ?').run(id)
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] deleteTask failed for id=${id}: ${msg}`)
  }
}

export function claimTask(id: string, claimedBy: string, maxActive?: number): SprintTask | null {
  try {
    const db = getDb()
    const now = new Date().toISOString()

    if (maxActive !== undefined) {
      // Atomic WIP check — single transaction prevents TOCTOU race
      const result = db.transaction(() => {
        const { count } = db
          .prepare("SELECT COUNT(*) as count FROM sprint_tasks WHERE status = 'active'")
          .get() as { count: number }
        if (count >= maxActive) return null

        // DL-13 & DL-18: Record audit trail before update (pass db for consistency)
        const oldTask = getTask(id, db)
        if (!oldTask) return null

        const updated = db
          .prepare(
            `UPDATE sprint_tasks
             SET status = 'active', claimed_by = ?, started_at = ?
             WHERE id = ? AND status = 'queued'
             RETURNING *`
          )
          .get(claimedBy, now, id) as Record<string, unknown> | undefined

        if (updated) {
          recordTaskChanges(
            id,
            oldTask as unknown as Record<string, unknown>,
            { status: 'active', claimed_by: claimedBy, started_at: now },
            claimedBy,
            db
          )
        }

        return updated
      })()

      return result ? sanitizeTask(result) : null
    }

    // No WIP limit — original behavior with audit trail
    return db.transaction(() => {
      const oldTask = getTask(id, db)
      if (!oldTask) return null

      const result = db
        .prepare(
          `UPDATE sprint_tasks
           SET status = 'active', claimed_by = ?, started_at = ?
           WHERE id = ? AND status = 'queued'
           RETURNING *`
        )
        .get(claimedBy, now, id) as Record<string, unknown> | undefined

      if (result) {
        recordTaskChanges(
          id,
          oldTask as unknown as Record<string, unknown>,
          { status: 'active', claimed_by: claimedBy, started_at: now },
          claimedBy,
          db
        )
        return sanitizeTask(result)
      }

      return null
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] claimTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function releaseTask(id: string, claimedBy: string): SprintTask | null {
  try {
    const db = getDb()
    // DL-13 & DL-18: Record audit trail for release (pass db for consistency)
    return db.transaction(() => {
      const oldTask = getTask(id, db)
      if (!oldTask) return null

      const result = db
        .prepare(
          `UPDATE sprint_tasks
           SET status = 'queued', claimed_by = NULL, started_at = NULL, agent_run_id = NULL
           WHERE id = ? AND status = 'active' AND claimed_by = ?
           RETURNING *`
        )
        .get(id, claimedBy) as Record<string, unknown> | undefined

      if (result) {
        recordTaskChanges(
          id,
          oldTask as unknown as Record<string, unknown>,
          { status: 'queued', claimed_by: null, started_at: null, agent_run_id: null },
          claimedBy,
          db
        )
        return sanitizeTask(result)
      }

      return null
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] releaseTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function getQueueStats(): QueueStats {
  const stats: QueueStats = {
    backlog: 0,
    queued: 0,
    active: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
    error: 0,
    blocked: 0
  }

  try {
    const rows = getDb()
      .prepare('SELECT status, COUNT(*) as count FROM sprint_tasks GROUP BY status')
      .all() as Array<{ status: string; count: number }>

    for (const row of rows) {
      if (row.status in stats) {
        stats[row.status as keyof QueueStats] = row.count
      }
    }
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getQueueStats failed: ${msg}`)
  }

  return stats
}

export function getDoneTodayCount(): number {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const result = getDb()
      .prepare(
        'SELECT COUNT(*) as count FROM sprint_tasks WHERE status = ? AND completed_at >= ?'
      )
      .get('done', today.toISOString()) as { count: number }

    return result.count
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getDoneTodayCount failed: ${msg}`)
    return 0
  }
}

export function markTaskDoneByPrNumber(prNumber: number): string[] {
  try {
    const db = getDb()
    return db.transaction(() => {
      // Get affected tasks with full state for audit trail
      const affected = db
        .prepare('SELECT * FROM sprint_tasks WHERE pr_number = ? AND status = ?')
        .all(prNumber, 'active') as Array<Record<string, unknown>>

      const affectedIds = affected.map((r) => r.id as string)

      if (affectedIds.length > 0) {
        const completedAt = new Date().toISOString()

        // Record audit trail for each affected task
        for (const oldTask of affected) {
          try {
            recordTaskChanges(
              oldTask.id as string,
              oldTask,
              { status: 'done', completed_at: completedAt },
              'pr-poller',
              db
            )
          } catch (err) {
            logger.warn(
              `[sprint-queries] Failed to record changes for task ${oldTask.id}: ${err}`
            )
          }
        }

        // Transition active tasks to done
        db.prepare(
          'UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE pr_number = ? AND status = ?'
        ).run('done', completedAt, prNumber, 'active')
      }

      // Get tasks where pr_status will change for audit
      const prStatusAffected = db
        .prepare(
          "SELECT * FROM sprint_tasks WHERE pr_number = ? AND status = 'done' AND pr_status = 'open'"
        )
        .all(prNumber) as Array<Record<string, unknown>>

      // Record audit trail for pr_status changes
      for (const oldTask of prStatusAffected) {
        try {
          recordTaskChanges(
            oldTask.id as string,
            oldTask,
            { pr_status: 'merged' },
            'pr-poller',
            db
          )
        } catch (err) {
          logger.warn(
            `[sprint-queries] Failed to record pr_status change for task ${oldTask.id}: ${err}`
          )
        }
      }

      // Set pr_status to merged for done tasks with open PRs
      db.prepare(
        "UPDATE sprint_tasks SET pr_status = 'merged' WHERE pr_number = ? AND status = 'done' AND pr_status = 'open'"
      ).run(prNumber)

      return affectedIds
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] markTaskDoneByPrNumber failed for PR #${prNumber}: ${msg}`)
    return []
  }
}

export function markTaskCancelledByPrNumber(prNumber: number): string[] {
  try {
    const db = getDb()
    return db.transaction(() => {
      // Get affected tasks with full state for audit trail
      const affected = db
        .prepare('SELECT * FROM sprint_tasks WHERE pr_number = ? AND status = ?')
        .all(prNumber, 'active') as Array<Record<string, unknown>>

      const affectedIds = affected.map((r) => r.id as string)

      if (affectedIds.length > 0) {
        const completedAt = new Date().toISOString()

        // Record audit trail for each affected task
        for (const oldTask of affected) {
          try {
            recordTaskChanges(
              oldTask.id as string,
              oldTask,
              { status: 'cancelled', completed_at: completedAt },
              'pr-poller',
              db
            )
          } catch (err) {
            logger.warn(
              `[sprint-queries] Failed to record changes for task ${oldTask.id}: ${err}`
            )
          }
        }

        // Transition active tasks to cancelled
        db.prepare(
          'UPDATE sprint_tasks SET status = ?, completed_at = ? WHERE pr_number = ? AND status = ?'
        ).run('cancelled', completedAt, prNumber, 'active')
      }

      // Get tasks where pr_status will change for audit
      const prStatusAffected = db
        .prepare(
          "SELECT * FROM sprint_tasks WHERE pr_number = ? AND status = 'done' AND pr_status = 'open'"
        )
        .all(prNumber) as Array<Record<string, unknown>>

      // Record audit trail for pr_status changes
      for (const oldTask of prStatusAffected) {
        try {
          recordTaskChanges(
            oldTask.id as string,
            oldTask,
            { pr_status: 'closed' },
            'pr-poller',
            db
          )
        } catch (err) {
          logger.warn(
            `[sprint-queries] Failed to record pr_status change for task ${oldTask.id}: ${err}`
          )
        }
      }

      // Set pr_status to closed for done tasks with open PRs
      db.prepare(
        "UPDATE sprint_tasks SET pr_status = 'closed' WHERE pr_number = ? AND status = 'done' AND pr_status = 'open'"
      ).run(prNumber)

      return affectedIds
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] markTaskCancelledByPrNumber failed for PR #${prNumber}: ${msg}`)
    return []
  }
}

export function listTasksWithOpenPrs(): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        "SELECT * FROM sprint_tasks WHERE pr_number IS NOT NULL AND pr_status = 'open'"
      )
      .all() as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] listTasksWithOpenPrs failed: ${msg}`)
    return []
  }
}

export function updateTaskMergeableState(
  prNumber: number,
  mergeableState: string | null
): void {
  if (!mergeableState) return
  try {
    getDb()
      .prepare('UPDATE sprint_tasks SET pr_mergeable_state = ? WHERE pr_number = ?')
      .run(mergeableState, prNumber)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] updateTaskMergeableState failed for PR #${prNumber}: ${msg}`)
  }
}

export function getActiveTaskCount(): number {
  try {
    const result = getDb()
      .prepare("SELECT COUNT(*) as count FROM sprint_tasks WHERE status = 'active'")
      .get() as { count: number }
    return result.count
  } catch (err) {
    // DL-17: Standardize error message format
    // Fail-closed: return MAX to prevent new claims when DB is broken.
    // This is intentional — better to block claims than to over-saturate.
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getActiveTaskCount failed: ${msg}`)
    return Infinity
  }
}

export function getQueuedTasks(limit: number): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT * FROM sprint_tasks
         WHERE status = 'queued' AND claimed_by IS NULL
         ORDER BY priority ASC, created_at ASC
         LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getQueuedTasks failed: ${msg}`)
    return []
  }
}

export function getOrphanedTasks(claimedBy: string): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        "SELECT * FROM sprint_tasks WHERE status = 'active' AND claimed_by = ?"
      )
      .all(claimedBy) as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getOrphanedTasks failed: ${msg}`)
    return []
  }
}

export function clearSprintTaskFk(agentRunId: string): void {
  try {
    getDb()
      .prepare('UPDATE sprint_tasks SET agent_run_id = NULL WHERE agent_run_id = ?')
      .run(agentRunId)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] clearSprintTaskFk failed for agent_run_id=${agentRunId}: ${msg}`)
  }
}

export function getHealthCheckTasks(): SprintTask[] {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const rows = getDb()
      .prepare(
        "SELECT * FROM sprint_tasks WHERE status = 'active' AND started_at < ?"
      )
      .all(oneHourAgo) as Record<string, unknown>[]
    return sanitizeTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn(`[sprint-queries] getHealthCheckTasks failed: ${msg}`)
    return []
  }
}

export function getAllTaskIds(): Set<string> {
  // No try/catch: DB errors must propagate so callers get a 500,
  // not a misleading 400 "task IDs do not exist" from an empty Set.
  const rows = getDb()
    .prepare('SELECT id FROM sprint_tasks')
    .all() as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

export function getTasksWithDependencies(): Array<{
  id: string
  depends_on: TaskDependency[] | null
  status: string
}> {
  // No try/catch: DB errors must propagate (same rationale as getAllTaskIds).
  // Query ALL tasks, not just those with depends_on — cycle detection needs
  // the full graph to catch cycles involving tasks receiving their first dependency.
  const rows = getDb()
    .prepare('SELECT id, depends_on, status FROM sprint_tasks')
    .all() as Array<{ id: string; depends_on: string | null; status: string }>

  return rows.map((row) => ({
    ...row,
    depends_on: row.depends_on ? sanitizeDependsOn(row.depends_on) : null
  }))
}
