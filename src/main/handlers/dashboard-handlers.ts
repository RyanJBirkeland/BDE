import { getDb } from '../db'
import { safeHandle } from '../ipc-utils'

export function getCompletionsPerHour(): { hour: string; count: number }[] {
  const db = getDb()
  const rows = db
    .prepare(
      `
    SELECT
      strftime('%Y-%m-%dT%H:00:00', finished_at / 1000, 'unixepoch', 'localtime') AS hour,
      COUNT(*) AS count
    FROM agent_runs
    WHERE finished_at IS NOT NULL
      AND finished_at > (strftime('%s', 'now', '-24 hours') * 1000)
    GROUP BY hour
    ORDER BY hour ASC
  `
    )
    .all() as { hour: string; count: number }[]
  return rows
}

export function getRecentEvents(
  limit: number = 20
): { id: number; agent_id: string; event_type: string; payload: string; timestamp: number }[] {
  const db = getDb()
  const rows = db
    .prepare(
      `
    SELECT id, agent_id, event_type, payload, timestamp
    FROM agent_events
    ORDER BY timestamp DESC
    LIMIT ?
  `
    )
    .all(limit) as {
    id: number
    agent_id: string
    event_type: string
    payload: string
    timestamp: number
  }[]
  return rows
}

export function registerDashboardHandlers(): void {
  safeHandle('agent:completionsPerHour', async () => {
    return getCompletionsPerHour()
  })

  safeHandle('agent:recentEvents', async (_e: unknown, limit?: number) => {
    return getRecentEvents(limit)
  })
}
