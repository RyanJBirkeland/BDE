/**
 * Reporting and analytics queries for sprint tasks.
 * Extracted from sprint-queries.ts to improve modularity.
 *
 * All functions are synchronous and use the local SQLite database via getDb().
 */
import type Database from 'better-sqlite3'
import { getDb } from '../db'
import type { Logger } from '../logger'
import { withDataLayerError } from './data-utils'

// Module-level logger — defaults to console, injectable for testing/structured logging
let logger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
  debug: (m) => console.debug(m)
}

export function setReportingQueriesLogger(l: Logger): void {
  logger = l
}

// --- Type Definitions ---

export interface FailureReasonBreakdown {
  reason: string
  count: number
}

export interface TaskRuntimeStats {
  avgDurationMs: number | null
  minDurationMs: number | null
  maxDurationMs: number | null
  tasksWithDuration: number
}

export interface SpecTypeSuccessRate {
  spec_type: string | null
  done: number
  total: number
  success_rate: number
}

export interface DailySuccessRate {
  date: string
  successRate: number | null
  doneCount: number
  failedCount: number
}

const EMPTY_RUNTIME_STATS: TaskRuntimeStats = {
  avgDurationMs: null,
  minDurationMs: null,
  maxDurationMs: null,
  tasksWithDuration: 0
}

// --- Query Functions ---

export function getDoneTodayCount(db?: Database.Database): number {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const result = conn
        .prepare(
          'SELECT COUNT(*) as count FROM sprint_tasks WHERE status = ? AND completed_at >= ?'
        )
        .get('done', today.toISOString()) as { count: number }

      return result.count
    },
    'getDoneTodayCount',
    0,
    logger
  )
}

export function getFailureReasonBreakdown(db?: Database.Database): FailureReasonBreakdown[] {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const rows = conn
        .prepare(
          `SELECT
            COALESCE(failure_reason, 'Unknown') as reason,
            COUNT(*) as count
           FROM sprint_tasks
           WHERE status IN ('failed', 'error')
           GROUP BY failure_reason
           ORDER BY count DESC`
        )
        .all() as Array<{ reason: string; count: number }>

      return rows
    },
    'getFailureReasonBreakdown',
    [],
    logger
  )
}

/**
 * Get runtime statistics from completed tasks with duration_ms populated.
 * Returns aggregate stats (avg, min, max) for terminal tasks.
 */
export function getTaskRuntimeStats(db?: Database.Database): TaskRuntimeStats {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const result = conn
        .prepare(
          `SELECT
            AVG(duration_ms) as avgDurationMs,
            MIN(duration_ms) as minDurationMs,
            MAX(duration_ms) as maxDurationMs,
            COUNT(*) as tasksWithDuration
           FROM sprint_tasks
           WHERE duration_ms IS NOT NULL
             AND status IN ('done', 'failed', 'review')`
        )
        .get() as {
        avgDurationMs: number | null
        minDurationMs: number | null
        maxDurationMs: number | null
        tasksWithDuration: number
      }

      return {
        avgDurationMs: result.avgDurationMs,
        minDurationMs: result.minDurationMs,
        maxDurationMs: result.maxDurationMs,
        tasksWithDuration: result.tasksWithDuration
      }
    },
    'getTaskRuntimeStats',
    { ...EMPTY_RUNTIME_STATS },
    logger
  )
}

export function getSuccessRateBySpecType(db?: Database.Database): SpecTypeSuccessRate[] {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      const rows = conn
        .prepare(
          `SELECT
             spec_type,
             SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
             COUNT(*) as total
           FROM sprint_tasks
           WHERE status IN ('done', 'failed', 'error', 'cancelled')
           GROUP BY spec_type`
        )
        .all() as Array<{ spec_type: string | null; done: number; total: number }>

      return rows.map((row) => ({
        spec_type: row.spec_type ?? null,
        done: row.done,
        total: row.total,
        success_rate: row.total > 0 ? row.done / row.total : 0
      }))
    },
    'getSuccessRateBySpecType',
    [],
    logger
  )
}

/**
 * Get daily success rates for the last N days with gap-filling.
 * Success rate = done / (done + failed + error) per day.
 * Days with no terminal tasks return null success rate but are included in results.
 */
export function getDailySuccessRate(days: number = 14, db?: Database.Database): DailySuccessRate[] {
  const conn = db ?? getDb()
  return withDataLayerError(
    () => {
      // Generate continuous date range for last N days, then LEFT JOIN with task stats
      const rows = conn
        .prepare(
          `WITH RECURSIVE dates(date) AS (
            SELECT date('now', '-${days - 1} days')
            UNION ALL
            SELECT date(date, '+1 day')
            FROM dates
            WHERE date < date('now')
          ),
          daily_stats AS (
            SELECT
              date(completed_at) as date,
              COUNT(CASE WHEN status = 'done' THEN 1 END) as done,
              COUNT(CASE WHEN status IN ('failed', 'error') THEN 1 END) as failed
            FROM sprint_tasks
            WHERE completed_at IS NOT NULL
              AND date(completed_at) >= date('now', '-${days} days')
            GROUP BY date(completed_at)
          )
          SELECT
            dates.date,
            COALESCE(daily_stats.done, 0) as done,
            COALESCE(daily_stats.failed, 0) as failed
          FROM dates
          LEFT JOIN daily_stats ON dates.date = daily_stats.date
          ORDER BY dates.date ASC`
        )
        .all() as Array<{ date: string; done: number; failed: number }>

      return rows.map((row) => {
        const total = row.done + row.failed
        return {
          date: row.date,
          successRate: total > 0 ? (row.done / total) * 100 : null,
          doneCount: row.done,
          failedCount: row.failed
        }
      })
    },
    'getDailySuccessRate',
    [],
    logger
  )
}
