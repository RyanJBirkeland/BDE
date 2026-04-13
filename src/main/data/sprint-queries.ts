/**
 * Sprint task query functions — SQLite edition.
 * All functions are synchronous and use the local SQLite database via getDb().
 */
import type Database from 'better-sqlite3'
import type { SprintTask, TaskDependency } from '../../shared/types'
import { sanitizeDependsOn } from '../../shared/sanitize-depends-on'
import { sanitizeTags } from '../../shared/sanitize-tags'
import { getDb } from '../db'
import { recordTaskChanges } from './task-changes'
import { withRetry } from './sqlite-retry'
import { getErrorMessage } from '../../shared/errors'
import { nowIso } from '../../shared/time'
import { SPRINT_TASK_COLUMNS } from './sprint-query-constants'
import { validateTransition } from '../../shared/task-state-machine'
import { getSprintQueriesLogger } from './sprint-query-logger'
import { mapRowToTask, mapRowsToTasks, serializeFieldForStorage } from './sprint-task-mapper'
import { UPDATE_ALLOWLIST, COLUMN_MAP } from './sprint-task-types'
import type { CreateTaskInput, QueueStats } from './sprint-task-types'

// Re-export reporting functions and types for backward compatibility
export {
  getDoneTodayCount,
  getFailureReasonBreakdown,
  getTaskRuntimeStats,
  getSuccessRateBySpecType,
  getDailySuccessRate
} from './reporting-queries'
export type {
  FailureReasonBreakdown,
  TaskRuntimeStats,
  SpecTypeSuccessRate,
  DailySuccessRate
} from './reporting-queries'

// Re-export logger infrastructure for backward compatibility
export { setSprintQueriesLogger, withErrorLogging } from './sprint-query-logger'

// Re-export mapper for backward compatibility
export { mapRowToTask, mapRowsToTasks } from './sprint-task-mapper'

// Re-export types and constants for backward compatibility
export { UPDATE_ALLOWLIST, COLUMN_MAP } from './sprint-task-types'
export type { QueueStats, CreateTaskInput } from './sprint-task-types'

// Re-export PR lifecycle ops for backward compatibility
export {
  markTaskDoneByPrNumber,
  markTaskCancelledByPrNumber,
  listTasksWithOpenPrs,
  updateTaskMergeableState
} from './sprint-pr-ops'


export function getTask(id: string, db?: Database.Database): SprintTask | null {
  try {
    const conn = db ?? getDb()
    const row = conn
      .prepare(`SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined
    return row ? mapRowToTask(row) : null
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] getTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function listTasks(status?: string): SprintTask[] {
  try {
    const db = getDb()
    if (status) {
      const rows = db
        .prepare(
          `SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE status = ? ORDER BY priority ASC, created_at ASC`
        )
        .all(status) as Record<string, unknown>[]
      return mapRowsToTasks(rows)
    }
    const rows = db
      .prepare(
        `SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks ORDER BY priority ASC, created_at ASC`
      )
      .all() as Record<string, unknown>[]
    return mapRowsToTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] listTasks failed: ${msg}`)
    return []
  }
}

export function listTasksRecent(): SprintTask[] {
  try {
    const db = getDb()
    // F-t3-db-2: Rewrite OR-clause as UNION ALL of two index-able branches.
    // The original `WHERE status NOT IN (...) OR completed_at >= ...` forced
    // a full SCAN because OR across columns prevents single-index use. The
    // UNION ALL form lets each branch use idx_sprint_tasks_status:
    //   1) active set: status IN (5 active statuses)
    //   2) recent terminal set: status IN (4 terminal) AND completed_at recent
    const rows = db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM sprint_tasks
             WHERE status IN ('backlog','queued','blocked','active','review')
           UNION ALL
           SELECT * FROM sprint_tasks
             WHERE status IN ('done','cancelled','failed','error')
               AND completed_at >= datetime('now', '-7 days')
         )
         ORDER BY priority ASC, created_at ASC`
      )
      .all() as Record<string, unknown>[]
    return mapRowsToTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] listTasksRecent failed: ${msg}`)
    return []
  }
}

export function createTask(input: CreateTaskInput): SprintTask | null {
  try {
    const db = getDb()
    const dependsOn = sanitizeDependsOn(input.depends_on)
    const tags = sanitizeTags(input.tags)

    const result = db
      .prepare(
        `INSERT INTO sprint_tasks (title, repo, prompt, spec, notes, priority, status, template_name, depends_on, playground_enabled, model, tags, group_id, cross_repo_contract)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        input.playground_enabled ? 1 : 0,
        input.model ?? null,
        tags ? JSON.stringify(tags) : null,
        input.group_id ?? null,
        input.cross_repo_contract ?? null
      ) as Record<string, unknown> | undefined

    return result ? mapRowToTask(result) : null
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] createTask failed: ${msg}`)
    return null
  }
}

/**
 * Create a sprint task in `review` status directly, populated from a completed
 * adhoc agent's worktree. Bypasses the normal `backlog → queued → active → review`
 * state machine because the work is already done — the agent committed it locally
 * and the user is explicitly promoting it for review.
 *
 * Used by the `agents:promoteToReview` IPC handler. Do not call from anywhere
 * that should respect the standard task lifecycle.
 */
export function createReviewTaskFromAdhoc(input: {
  title: string
  repo: string
  spec: string
  worktreePath: string
  branch: string
}): SprintTask | null {
  // Reuse createTask instead of duplicating INSERT logic
  const task = createTask({
    title: input.title,
    repo: input.repo,
    spec: input.spec,
    prompt: input.spec, // prompt mirrors spec — keeps the agent's full task message accessible
    status: 'review'
  })

  if (!task) return null

  // Set fields not in the create allowlist (worktree_path, started_at)
  const updated = updateTask(task.id, {
    worktree_path: input.worktreePath,
    started_at: nowIso()
  })

  if (updated) {
    getSprintQueriesLogger().info(
      `[sprint-queries] Promoted adhoc work to review task ${updated.id} (branch ${input.branch})`
    )
  }

  return updated
}

export function updateTask(id: string, patch: Record<string, unknown>): SprintTask | null {
  const entries = Object.entries(patch).filter(([k]) => UPDATE_ALLOWLIST.has(k))
  if (entries.length === 0) return null

  try {
    const db = getDb()

    // Wrap read, update, and audit in a single transaction with retry on SQLITE_BUSY
    return withRetry(() =>
      db.transaction(() => {
        // Fetch current state for change tracking
        const oldTask = getTask(id, db)
        if (!oldTask) return null

        // Enforce status transition state machine
        if (patch.status && typeof patch.status === 'string') {
          const currentStatus = oldTask.status as string
          const validationResult = validateTransition(currentStatus, patch.status)
          if (!validationResult.ok) {
            throw new Error(
              `[sprint-queries] Invalid transition for task ${id}: ${validationResult.reason}`
            )
          }
        }

        // F-t3-model-1: Filter unchanged fields at the caller level. Reduces
        // write amplification on both sprint_tasks (no UPDATE) and task_changes
        // (no audit row). Defense-in-depth — recordTaskChanges also skips
        // unchanged values, but filtering here also avoids the SQL UPDATE.
        const changedEntries = entries.filter(([key, value]) => {
          const serializedNew = serializeFieldForStorage(key, value)
          const oldRaw = (oldTask as unknown as Record<string, unknown>)[key]
          const serializedOld = serializeFieldForStorage(key, oldRaw)
          return serializedNew !== serializedOld
        })

        // No-op: nothing actually changed. Return the existing task without
        // touching sprint_tasks or task_changes.
        if (changedEntries.length === 0) {
          return oldTask
        }

        // Build SET clause with serialized values
        const setClauses: string[] = []
        const values: unknown[] = []
        const auditPatch: Record<string, unknown> = {}

        for (const [key, value] of changedEntries) {
          // F-t3-datalyr-7: Whitelist Map replaces regex for defense-in-depth
          const colName = COLUMN_MAP.get(key)
          if (!colName) {
            throw new Error(`Invalid column name: ${key}`)
          }
          setClauses.push(`${colName} = ?`)
          const serialized = serializeFieldForStorage(key, value)
          values.push(serialized)
          // For audit, store the sanitized form for depends_on/tags but original for others
          if (key === 'depends_on') {
            auditPatch[key] = sanitizeDependsOn(value)
          } else if (key === 'tags') {
            auditPatch[key] = sanitizeTags(value)
          } else {
            auditPatch[key] = value
          }
        }

        values.push(id)

        const result = db
          .prepare(
            `UPDATE sprint_tasks SET ${setClauses.join(', ')} WHERE id = ?
             RETURNING ${SPRINT_TASK_COLUMNS}`
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
          getSprintQueriesLogger().warn(`[sprint-queries] Failed to record task changes: ${err}`)
          // Re-throw to abort transaction
          throw err
        }

        return mapRowToTask(result)
      })()
    )
  } catch (err) {
    // Re-throw invalid transition errors so callers can surface them to the UI
    if (err instanceof Error && err.message.includes('Invalid transition')) {
      throw err
    }
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] updateTask failed for id=${id}: ${msg}`)
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
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] deleteTask failed for id=${id}: ${msg}`)
  }
}

function checkWipLimit(db: Database.Database, maxActive: number): boolean {
  const { count } = db
    .prepare("SELECT COUNT(*) as count FROM sprint_tasks WHERE status = 'active'")
    .get() as { count: number }
  return count < maxActive
}

export function claimTask(id: string, claimedBy: string, maxActive?: number): SprintTask | null {
  try {
    const db = getDb()
    const now = nowIso()

    // Atomic WIP check + claim in single transaction with retry on SQLITE_BUSY
    const result = withRetry(() =>
      db.transaction(() => {
        // Optional WIP limit enforcement
        if (maxActive !== undefined && !checkWipLimit(db, maxActive)) {
          return null
        }

        // DL-13 & DL-18: Record audit trail before update (pass db for consistency)
        const oldTask = getTask(id, db)
        if (!oldTask) return null

        const updated = db
          .prepare(
            `UPDATE sprint_tasks
             SET status = 'active', claimed_by = ?, started_at = ?
             WHERE id = ? AND status = 'queued'
             RETURNING ${SPRINT_TASK_COLUMNS}`
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
    )

    return result ? mapRowToTask(result) : null
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] claimTask failed for id=${id}: ${msg}`)
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
           RETURNING ${SPRINT_TASK_COLUMNS}`
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
        return mapRowToTask(result)
      }

      return null
    })()
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] releaseTask failed for id=${id}: ${msg}`)
    return null
  }
}

export function getQueueStats(): QueueStats {
  const stats: QueueStats = {
    backlog: 0,
    queued: 0,
    active: 0,
    review: 0,
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
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] getQueueStats failed: ${msg}`)
  }

  return stats
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
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] getActiveTaskCount failed: ${msg}`)
    return Infinity
  }
}

export function getQueuedTasks(limit: number): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT ${SPRINT_TASK_COLUMNS}
         FROM sprint_tasks
         WHERE status = 'queued' AND claimed_by IS NULL AND (next_eligible_at IS NULL OR next_eligible_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ORDER BY priority ASC, created_at ASC
         LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[]
    return mapRowsToTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] getQueuedTasks failed: ${msg}`)
    return []
  }
}

export function getOrphanedTasks(claimedBy: string): SprintTask[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT ${SPRINT_TASK_COLUMNS}
         FROM sprint_tasks WHERE status = 'active' AND claimed_by = ?`
      )
      .all(claimedBy) as Record<string, unknown>[]
    return mapRowsToTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] getOrphanedTasks failed: ${msg}`)
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
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] clearSprintTaskFk failed for agent_run_id=${agentRunId}: ${msg}`)
  }
}

export function getHealthCheckTasks(): SprintTask[] {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const rows = getDb()
      .prepare(
        `SELECT ${SPRINT_TASK_COLUMNS}
         FROM sprint_tasks WHERE status = 'active' AND started_at < ?`
      )
      .all(oneHourAgo) as Record<string, unknown>[]
    return mapRowsToTasks(rows)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(`[sprint-queries] getHealthCheckTasks failed: ${msg}`)
    return []
  }
}

export function getAllTaskIds(): Set<string> {
  // No try/catch: DB errors must propagate so callers get a 500,
  // not a misleading 400 "task IDs do not exist" from an empty Set.
  const rows = getDb().prepare('SELECT id FROM sprint_tasks').all() as Array<{ id: string }>
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
  const rows = getDb().prepare('SELECT id, depends_on, status FROM sprint_tasks').all() as Array<{
    id: string
    depends_on: string | null
    status: string
  }>

  return rows.map((row) => ({
    ...row,
    depends_on: row.depends_on ? sanitizeDependsOn(row.depends_on) : null
  }))
}

/**
 * How many days to retain `review_diff_snapshot` blobs for tasks in terminal
 * states. Snapshots are only useful while a task is in `review` — once
 * merged/discarded their value drops sharply, but at ~500KB per row they can
 * cause significant database bloat over time. Tunable here.
 */
export const DIFF_SNAPSHOT_RETENTION_DAYS = 30

/**
 * Null out `review_diff_snapshot` for tasks in terminal states older than
 * `retentionDays` days. Returns the number of rows updated.
 *
 * Snapshots on tasks still in `review` (or any non-terminal state) are
 * preserved unconditionally — the cleanup only targets done / cancelled /
 * failed / error tasks where the worktree is long gone and the snapshot is
 * unlikely to be useful.
 */
export function pruneOldDiffSnapshots(
  retentionDays: number = DIFF_SNAPSHOT_RETENTION_DAYS,
  db?: Database.Database
): number {
  const conn = db ?? getDb()
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
  const result = conn
    .prepare(
      `UPDATE sprint_tasks
       SET review_diff_snapshot = NULL
       WHERE review_diff_snapshot IS NOT NULL
         AND status IN ('done', 'cancelled', 'failed', 'error')
         AND updated_at < ?`
    )
    .run(cutoff)
  return result.changes
}
