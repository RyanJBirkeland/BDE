import type Database from 'better-sqlite3'
import type { SprintTask, SprintTaskCore, TaskDependency } from '../../shared/types'
import { sanitizeDependsOn } from '../../shared/sanitize-depends-on'
import { getDb } from '../db'
import { SPRINT_TASK_COLUMNS } from './sprint-query-constants'
import { mapRowsToTasks } from './sprint-task-mapper'
import { getSprintQueriesLogger } from './sprint-query-logger'
import { recordTaskChangesBulk } from './task-changes'
import type { QueueStats } from './sprint-task-types'
import { withDataLayerError } from './data-utils'
import { MS_PER_HOUR } from '../../shared/time'

const EMPTY_QUEUE_STATS: QueueStats = {
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

function isQueueStatsKey(status: string): status is keyof QueueStats {
  return status in EMPTY_QUEUE_STATS
}

export function getQueueStats(db?: Database.Database): QueueStats {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const stats: QueueStats = { ...EMPTY_QUEUE_STATS }
      const rows = conn
        .prepare('SELECT status, COUNT(*) as count FROM sprint_tasks GROUP BY status')
        .all() as Array<{ status: string; count: number }>

      for (const row of rows) {
        if (isQueueStatsKey(row.status)) {
          stats[row.status] = row.count
        }
        // Unknown status — skip to avoid corrupting dashboard metrics
      }
      return stats
    },
    'getQueueStats',
    { ...EMPTY_QUEUE_STATS },
    getSprintQueriesLogger()
  )
}

export function getOrphanedTasks(claimedBy: string, db?: Database.Database): SprintTask[] {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const rows = conn
        .prepare(
          `SELECT ${SPRINT_TASK_COLUMNS}
           FROM sprint_tasks WHERE status = 'active' AND claimed_by = ?`
        )
        .all(claimedBy) as Record<string, unknown>[]
      return mapRowsToTasks(rows)
    },
    `getOrphanedTasks(claimedBy=${claimedBy})`,
    [],
    getSprintQueriesLogger()
  )
}

/**
 * Clears claimed_by for all tasks held by the given executor, regardless of status.
 * Used on startup to release stale claims from the previous process session
 * (e.g. tasks stuck in 'review' or other non-active statuses with a leftover claim).
 * Wrapped in a transaction so the audit trail and the UPDATE succeed or fail together.
 * Returns the number of rows updated.
 */
export function clearStaleClaimedBy(claimedBy: string, db?: Database.Database): number {
  const conn = db ?? getDb()
  return withDataLayerError(
    () =>
      conn.transaction(() => {
        const affected = conn
          .prepare(`SELECT ${SPRINT_TASK_COLUMNS} FROM sprint_tasks WHERE claimed_by = ?`)
          .all(claimedBy) as Array<Record<string, unknown>>

        if (affected.length === 0) return 0

        recordTaskChangesBulk(
          affected.map((oldTask) => ({
            taskId: oldTask.id as string,
            oldTask,
            newPatch: { claimed_by: null }
          })),
          'system:startup',
          conn
        )

        const result = conn
          .prepare(`UPDATE sprint_tasks SET claimed_by = NULL WHERE claimed_by = ?`)
          .run(claimedBy)
        return result.changes
      })(),
    `clearStaleClaimedBy(claimedBy=${claimedBy})`,
    0,
    getSprintQueriesLogger()
  )
}

export function clearSprintTaskFk(agentRunId: string, db?: Database.Database): void {
  const conn = db ?? getDb()
  withDataLayerError(
    () => {
      conn
        .prepare('UPDATE sprint_tasks SET agent_run_id = NULL WHERE agent_run_id = ?')
        .run(agentRunId)
    },
    `clearSprintTaskFk(agentRunId=${agentRunId})`,
    undefined,
    getSprintQueriesLogger()
  )
}

export function getHealthCheckTasks(db?: Database.Database): SprintTaskCore[] {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const oneHourAgo = new Date(Date.now() - MS_PER_HOUR).toISOString()
      const rows = conn
        .prepare(
          `SELECT ${SPRINT_TASK_COLUMNS}
           FROM sprint_tasks WHERE status = 'active' AND started_at < ?`
        )
        .all(oneHourAgo) as Record<string, unknown>[]
      return mapRowsToTasks(rows)
    },
    'getHealthCheckTasks',
    [],
    getSprintQueriesLogger()
  )
}

export function getAllTaskIds(db?: Database.Database): Set<string> {
  // No try/catch: DB errors must propagate so callers get a 500,
  // not a misleading 400 "task IDs do not exist" from an empty Set.
  const conn = db ?? getDb()
  const rows = conn.prepare('SELECT id FROM sprint_tasks').all() as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

export function getTasksWithDependencies(db?: Database.Database): Array<{
  id: string
  depends_on: TaskDependency[] | null
  status: string
}> {
  // No try/catch: DB errors must propagate (same rationale as getAllTaskIds).
  // Query ALL tasks, not just those with depends_on — cycle detection needs
  // the full graph to catch cycles involving tasks receiving their first dependency.
  const conn = db ?? getDb()
  const rows = conn.prepare('SELECT id, depends_on, status FROM sprint_tasks').all() as Array<{
    id: string
    depends_on: string | null
    status: string
  }>

  return rows.map((row) => ({
    ...row,
    depends_on: row.depends_on ? sanitizeDependsOn(row.depends_on) : null
  }))
}
