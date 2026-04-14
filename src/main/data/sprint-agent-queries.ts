import type Database from 'better-sqlite3'
import type { SprintTask, TaskDependency } from '../../shared/types'
import { sanitizeDependsOn } from '../../shared/sanitize-depends-on'
import { getDb } from '../db'
import { SPRINT_TASK_COLUMNS } from './sprint-query-constants'
import { mapRowsToTasks } from './sprint-task-mapper'
import { getSprintQueriesLogger } from './sprint-query-logger'
import { getErrorMessage } from '../../shared/errors'
import type { QueueStats } from './sprint-task-types'

export function getQueueStats(db?: Database.Database): QueueStats {
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
    const conn = db ?? getDb()
    const rows = conn
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

export function getOrphanedTasks(claimedBy: string, db?: Database.Database): SprintTask[] {
  try {
    const conn = db ?? getDb()
    const rows = conn
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

/**
 * Clears claimed_by for all tasks held by the given executor, regardless of status.
 * Used on startup to release stale claims from the previous process session
 * (e.g. tasks stuck in 'review' or other non-active statuses with a leftover claim).
 * Returns the number of rows updated.
 */
export function clearStaleClaimedBy(claimedBy: string, db?: Database.Database): number {
  try {
    const conn = db ?? getDb()
    const result = conn
      .prepare(`UPDATE sprint_tasks SET claimed_by = NULL WHERE claimed_by = ?`)
      .run(claimedBy)
    return result.changes
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(
      `[sprint-queries] clearStaleClaimedBy failed for claimedBy=${claimedBy}: ${msg}`
    )
    return 0
  }
}

export function clearSprintTaskFk(agentRunId: string, db?: Database.Database): void {
  try {
    const conn = db ?? getDb()
    conn
      .prepare('UPDATE sprint_tasks SET agent_run_id = NULL WHERE agent_run_id = ?')
      .run(agentRunId)
  } catch (err) {
    // DL-17: Standardize error message format
    const msg = getErrorMessage(err)
    getSprintQueriesLogger().warn(
      `[sprint-queries] clearSprintTaskFk failed for agent_run_id=${agentRunId}: ${msg}`
    )
  }
}

export function getHealthCheckTasks(db?: Database.Database): SprintTask[] {
  try {
    const conn = db ?? getDb()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const rows = conn
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
