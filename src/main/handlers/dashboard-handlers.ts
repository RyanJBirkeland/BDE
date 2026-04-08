import { getDb } from '../db'
import { safeHandle } from '../ipc-utils'
import { getDailySuccessRate } from '../data/sprint-queries'
import { getLoadSnapshot } from '../services/load-sampler'

export function getCompletionsPerHour(): {
  hour: string
  successCount: number
  failedCount: number
}[] {
  const db = getDb()
  const rows = db
    .prepare(
      `
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
    )
    .all() as { hour: string; successCount: number; failedCount: number }[]
  return rows
}

export function getRecentEvents(limit: number = 20): {
  id: number
  agent_id: string
  event_type: string
  payload: string
  timestamp: number
  task_title: string | null
}[] {
  const db = getDb()
  const rows = db
    .prepare(
      `
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
    )
    .all(limit) as {
    id: number
    agent_id: string
    event_type: string
    payload: string
    timestamp: number
    task_title: string | null
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

  safeHandle('dashboard:dailySuccessRate', async (_e: unknown, days?: number) => {
    return getDailySuccessRate(days)
  })

  safeHandle('system:loadAverage', async () => {
    return getLoadSnapshot()
  })
}
