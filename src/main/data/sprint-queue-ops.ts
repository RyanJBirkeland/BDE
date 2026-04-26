import type Database from 'better-sqlite3'
import type { SprintTask, SprintTaskExecution } from '../../shared/types'
import { getDb } from '../db'
import { recordTaskChanges } from './task-changes'
import { withRetryAsync } from './sqlite-retry'
import { nowIso } from '../../shared/time'
import { SPRINT_TASK_COLUMNS } from './sprint-query-constants'
import { mapRowToTask, mapRowsToTasks } from './sprint-task-mapper'
import { getSprintQueriesLogger } from './sprint-query-logger'
import { withDataLayerError } from './data-utils'
import { validateTransition } from '../../shared/task-state-machine'

/** Module-private: read one task by id within an open transaction. */
function fetchTask(id: string, db: Database.Database): SprintTask | null {
  const row = db.prepare(`SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined
  return row ? mapRowToTask(row) : null
}

/**
 * Adapt a `SprintTask` to the `Record<string, unknown>` shape required by
 * `recordTaskChanges`. The audit writer treats the task as a field bag; this
 * helper copies the properties into an indexable record so we never rely on
 * structural casts that would let typoed field names slip through silently.
 */
function toAuditableTask(task: SprintTask): Record<string, unknown> {
  return Object.fromEntries(Object.entries(task))
}

function checkWipLimit(db: Database.Database, maxActive: number): boolean {
  const { count } = db
    .prepare("SELECT COUNT(*) as count FROM sprint_tasks WHERE status = 'active'")
    .get() as { count: number }
  return count < maxActive
}

export async function claimTask(
  id: string,
  claimedBy: string,
  maxActive?: number,
  db?: Database.Database
): Promise<SprintTaskExecution | null> {
  const conn = db ?? getDb()
  const now = nowIso()

  // Atomic WIP check + claim in IMMEDIATE transaction with async retry on SQLITE_BUSY.
  // withRetryAsync uses setTimeout for backoff so the main thread stays responsive
  // under contention (replacing the blocking Atomics.wait in withRetry).
  // IMMEDIATE acquires the write lock upfront to prevent concurrent WIP-check races.
  try {
    const result = await withRetryAsync(
      () =>
        conn.transaction(() => {
          if (maxActive !== undefined && !checkWipLimit(conn, maxActive)) {
            return null
          }

          // DL-13 & DL-18: Record audit trail before update (pass conn for consistency)
          const oldTask = fetchTask(id, conn)
        if (!oldTask) return null

        const claimValidation = validateTransition(oldTask.status, 'active')
        if (!claimValidation.ok) {
          getSprintQueriesLogger().warn(
            `[sprint-queue-ops] claimTask(id=${id}, title="${oldTask.title}"): invalid transition ${oldTask.status} → active — ${claimValidation.reason}`
          )
          return null
        }

        const updated = conn
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
            toAuditableTask(oldTask),
            { status: 'active', claimed_by: claimedBy, started_at: now },
            claimedBy,
            conn
          )
        }

        return updated
      })(),
      { logger: getSprintQueriesLogger() }
    )

    return result ? mapRowToTask(result) : null
  } catch (err) {
    getSprintQueriesLogger().warn(
      `[sprint-queue-ops] claimTask(id=${id}) failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

export async function releaseTask(
  id: string,
  claimedBy: string,
  db?: Database.Database
): Promise<SprintTask | null> {
  const conn = db ?? getDb()
  try {
    // DL-13 & DL-18: Record audit trail for release (pass conn for consistency)
    return await withRetryAsync(() =>
      conn.transaction(() => {
        const oldTask = fetchTask(id, conn)
        if (!oldTask) return null

        const releaseValidation = validateTransition(oldTask.status, 'queued')
        if (!releaseValidation.ok) {
          getSprintQueriesLogger().warn(
            `[sprint-queue-ops] releaseTask(id=${id}): ${releaseValidation.reason}`
          )
          return null
        }

        const result = conn
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
            toAuditableTask(oldTask),
            { status: 'queued', claimed_by: null, started_at: null, agent_run_id: null },
            claimedBy,
            conn
          )
          return mapRowToTask(result)
        }

        return null
      })()
    )
  } catch (err) {
    getSprintQueriesLogger().warn(
      `[sprint-queue-ops] releaseTask(id=${id}) failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

export function getActiveTaskCount(db?: Database.Database): number {
  const conn = db ?? getDb()
  // Fail-closed: return Infinity to prevent new claims when DB is broken.
  // Better to block claims than to over-saturate on a broken DB.
  return withDataLayerError(
    () => {
      const result = conn
        .prepare("SELECT COUNT(*) as count FROM sprint_tasks WHERE status = 'active'")
        .get() as { count: number }
      return result.count
    },
    'getActiveTaskCount',
    Infinity,
    getSprintQueriesLogger()
  )
}

export function getQueuedTasks(limit: number, db?: Database.Database): SprintTask[] {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const rows = conn
        .prepare(
          `SELECT ${SPRINT_TASK_COLUMNS}
           FROM sprint_tasks
           WHERE status = 'queued' AND claimed_by IS NULL AND (next_eligible_at IS NULL OR next_eligible_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           ORDER BY priority ASC, created_at ASC
           LIMIT ?`
        )
        .all(limit) as Record<string, unknown>[]
      return mapRowsToTasks(rows)
    },
    'getQueuedTasks',
    [],
    getSprintQueriesLogger()
  )
}
