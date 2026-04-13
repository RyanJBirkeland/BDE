/**
 * Sprint task queue statistics and dashboard queries.
 * Extracted from sprint-queries.ts to improve modularity.
 */
import type { SprintTask } from '../../shared/types'
import { getDb } from '../db'
import type { Logger } from '../logger'
import { getErrorMessage } from '../../shared/errors'
import { SPRINT_TASK_COLUMNS } from './sprint-query-constants'
import { mapRowsToTasks } from './sprint-task-crud'

// Module-level logger — defaults to console, injectable for testing/structured logging
let logger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m)
}

export function setQueueStatsLogger(l: Logger): void {
  logger = l
}

export interface QueueStats {
  [key: string]: number
  backlog: number
  queued: number
  active: number
  review: number
  done: number
  failed: number
  cancelled: number
  error: number
  blocked: number
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
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-queue-stats] getQueueStats failed: ${msg}`)
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
    // Fail-closed: return MAX to prevent new claims when DB is broken.
    // This is intentional — better to block claims than to over-saturate.
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-queue-stats] getActiveTaskCount failed: ${msg}`)
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
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-queue-stats] getQueuedTasks failed: ${msg}`)
    return []
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
    const msg = getErrorMessage(err)
    logger.warn(`[sprint-queue-stats] getHealthCheckTasks failed: ${msg}`)
    return []
  }
}
