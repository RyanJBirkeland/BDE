/**
 * Dashboard analytics query functions.
 * All functions accept `db?: Database.Database` for testability; production
 * callers omit it and receive the singleton from `getDb()`.
 */
import type Database from 'better-sqlite3'
import type { DashboardEvent } from '../../shared/ipc-channels/ui-channels'
import { getDb } from '../db'

interface AgentEventRow {
  id: number
  agent_id: string
  event_type: string
  payload: string
  timestamp: number
  task_title: string | null
}

function rowToEvent(row: AgentEventRow): DashboardEvent {
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>
  } catch {
    // Malformed payload — return empty object rather than crashing
  }
  return {
    id: row.id,
    agentId: row.agent_id,
    eventType: row.event_type,
    payload,
    timestamp: row.timestamp,
    taskTitle: row.task_title
  }
}

/**
 * Get hourly completion stats for the last 24 hours.
 */
export function getCompletionsPerHour(
  db?: Database.Database
): { hour: string; successCount: number; failedCount: number }[] {
  const database = db ?? getDb()
  const sql = `
    SELECT
      strftime('%Y-%m-%dT%H:00:00', finished_at / 1000, 'unixepoch', 'localtime') AS hour,
      SUM(CASE WHEN status = 'done'   THEN 1 ELSE 0 END) AS successCount,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount
    FROM agent_runs
    WHERE finished_at IS NOT NULL
      AND finished_at > (strftime('%s', 'now', '-24 hours') * 1000)
    GROUP BY hour
    ORDER BY hour ASC
  `
  return database.prepare(sql).all() as {
    hour: string
    successCount: number
    failedCount: number
  }[]
}

/**
 * Get recent agent events with task context.
 * Transforms raw DB rows to camelCase `DashboardEvent` objects before returning,
 * so the IPC boundary never leaks snake_case column names or unparsed JSON.
 */
export function getRecentEvents(limit: number = 20, db?: Database.Database): DashboardEvent[] {
  const database = db ?? getDb()
  const sql = `
    SELECT
      ae.id,
      ae.agent_id,
      ae.event_type,
      ae.payload,
      ae.timestamp,
      st.title as task_title
    FROM agent_events ae
    LEFT JOIN agent_runs ar ON ae.agent_id = ar.id
    LEFT JOIN sprint_tasks st ON ar.sprint_task_id = st.id
    ORDER BY ae.timestamp DESC
    LIMIT ?
  `
  return (database.prepare(sql).all(limit) as AgentEventRow[]).map(rowToEvent)
}
