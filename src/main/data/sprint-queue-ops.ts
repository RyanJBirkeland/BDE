import type Database from 'better-sqlite3'
import type { SprintTask } from '../../shared/types'
import { getDb } from '../db'
import { recordTaskChanges } from './task-changes'
import { withRetry } from './sqlite-retry'
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

function checkWipLimit(db: Database.Database, maxActive: number): boolean {
  const { count } = db
    .prepare("SELECT COUNT(*) as count FROM sprint_tasks WHERE status = 'active'")
    .get() as { count: number }
  return count < maxActive
}

export function claimTask(
  id: string,
  claimedBy: string,
  maxActive?: number,
  db?: Database.Database
): SprintTask | null {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const now = nowIso()

      // Atomic WIP check + claim in IMMEDIATE transaction with retry on SQLITE_BUSY.
      // IMMEDIATE acquires the write lock upfront, preventing a second concurrent
      // reader from passing the WIP check before either writer commits.
      const result = withRetry(() =>
        conn.transaction(() => {
          // Optional WIP limit enforcement
          if (maxActive !== undefined && !checkWipLimit(conn, maxActive)) {
            return null
          }
          // Note: better-sqlite3 transactions are synchronous and Node.js is single-threaded,
          // so true concurrent WIP violations from the same process are impossible.
          // The IMMEDIATE comment above documents intent for future multi-process scenarios.

          // DL-13 & DL-18: Record audit trail before update (pass conn for consistency)
          const oldTask = fetchTask(id, conn)
          if (!oldTask) return null

          const claimValidation = validateTransition(oldTask.status, 'active')
          if (!claimValidation.ok) {
            getSprintQueriesLogger().warn(
              `[sprint-queue-ops] claimTask(id=${id}): ${claimValidation.reason}`
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
              oldTask as unknown as Record<string, unknown>,
              { status: 'active', claimed_by: claimedBy, started_at: now },
              claimedBy,
              conn
            )
          }

          return updated
        })()
      )

      return result ? mapRowToTask(result) : null
    },
    `claimTask(id=${id})`,
    null,
    getSprintQueriesLogger()
  )
}

export function releaseTask(
  id: string,
  claimedBy: string,
  db?: Database.Database
): SprintTask | null {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      // DL-13 & DL-18: Record audit trail for release (pass conn for consistency)
      return conn.transaction(() => {
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
            oldTask as unknown as Record<string, unknown>,
            { status: 'queued', claimed_by: null, started_at: null, agent_run_id: null },
            claimedBy,
            conn
          )
          return mapRowToTask(result)
        }

        return null
      })()
    },
    `releaseTask(id=${id})`,
    null,
    getSprintQueriesLogger()
  )
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
