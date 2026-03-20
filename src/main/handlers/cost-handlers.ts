import { safeHandle } from '../ipc-utils'
import { getCostSummary, getRecentAgentRunsWithCost } from '../cost-queries'
import { getDb } from '../db'
import type { AgentCostRecord } from '../../shared/types'

const GET_AGENT_HISTORY_SQL = `
  SELECT ar.id, ar.model, ar.started_at, ar.finished_at,
         ar.cost_usd, ar.tokens_in, ar.tokens_out,
         ar.cache_read, ar.cache_create, ar.duration_ms, ar.num_turns,
         st.title, st.pr_url, st.repo
  FROM agent_runs ar
  LEFT JOIN sprint_tasks st ON st.agent_run_id = ar.id
  WHERE ar.finished_at IS NOT NULL
  ORDER BY ar.started_at DESC
  LIMIT ? OFFSET ?
`

interface AgentCostRow {
  id: string
  model: string | null
  started_at: string
  finished_at: string | null
  cost_usd: number | null
  tokens_in: number | null
  tokens_out: number | null
  cache_read: number | null
  cache_create: number | null
  duration_ms: number | null
  num_turns: number | null
  title: string | null
  pr_url: string | null
  repo: string | null
}

function rowToRecord(row: AgentCostRow): AgentCostRecord {
  return {
    id: row.id,
    model: row.model,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    costUsd: row.cost_usd,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    cacheRead: row.cache_read,
    cacheCreate: row.cache_create,
    durationMs: row.duration_ms,
    numTurns: row.num_turns,
    taskTitle: row.title,
    prUrl: row.pr_url,
    repo: row.repo
  }
}

export function registerCostHandlers(): void {
  safeHandle('cost:summary', () => getCostSummary())
  safeHandle('cost:agentRuns', (_e, args: { limit?: number }) =>
    getRecentAgentRunsWithCost(args.limit ?? 20)
  )

  safeHandle('cost:getAgentHistory', (_e, args?: { limit?: number; offset?: number }) => {
    const limit = args?.limit ?? 100
    const offset = args?.offset ?? 0
    const db = getDb()
    const rows = db.prepare(GET_AGENT_HISTORY_SQL).all(limit, offset) as AgentCostRow[]
    return rows.map(rowToRecord)
  })
}
