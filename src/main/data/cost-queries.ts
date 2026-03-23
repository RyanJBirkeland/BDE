/**
 * Cost queries — business logic for cost analytics.
 * All functions take `db: Database.Database` as first parameter for testability.
 * Extracted from src/main/cost-queries.ts.
 */
import type Database from 'better-sqlite3'
import type { AgentRunCostRow, CostSummary } from '../../shared/types'

interface SummaryCountRow {
  cnt: number
}

interface SummaryTokenRow {
  total: number
}

interface SummaryAvgRow {
  avg: number | null
}

interface MostExpensiveRow {
  task: string
  cost_usd: number
}

interface AgentRunCostDbRow {
  id: string
  task: string | null
  repo: string | null
  status: string
  cost_usd: number | null
  tokens_in: number | null
  tokens_out: number | null
  cache_read: number | null
  cache_create: number | null
  duration_ms: number | null
  num_turns: number | null
  started_at: string
  finished_at: string | null
  pr_url: string | null
}

export function getCostSummary(db: Database.Database): CostSummary {
  const tasksToday = (
    db.prepare(
      "SELECT COUNT(*) as cnt FROM agent_runs WHERE status = 'done' AND started_at >= date('now', 'start of day')"
    ).get() as SummaryCountRow
  ).cnt

  const tasksThisWeek = (
    db.prepare(
      "SELECT COUNT(*) as cnt FROM agent_runs WHERE status = 'done' AND started_at >= date('now', '-7 days')"
    ).get() as SummaryCountRow
  ).cnt

  const tasksAllTime = (
    db.prepare(
      "SELECT COUNT(*) as cnt FROM agent_runs WHERE status = 'done'"
    ).get() as SummaryCountRow
  ).cnt

  const totalTokensThisWeek = (
    db.prepare(
      "SELECT COALESCE(SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)), 0) as total FROM agent_runs WHERE started_at >= date('now', '-7 days')"
    ).get() as SummaryTokenRow
  ).total

  const avgCostPerTask = (
    db.prepare(
      "SELECT AVG(cost_usd) as avg FROM agent_runs WHERE status = 'done' AND cost_usd IS NOT NULL"
    ).get() as SummaryAvgRow
  ).avg

  const mostExpensiveRow = db.prepare(
    "SELECT task, cost_usd FROM agent_runs WHERE status = 'done' AND cost_usd IS NOT NULL AND started_at >= date('now', '-7 days') ORDER BY cost_usd DESC LIMIT 1"
  ).get() as MostExpensiveRow | undefined

  return {
    tasksToday,
    tasksThisWeek,
    tasksAllTime,
    totalTokensThisWeek,
    avgCostPerTask: avgCostPerTask ?? null,
    mostExpensiveTask: mostExpensiveRow
      ? { task: mostExpensiveRow.task, costUsd: mostExpensiveRow.cost_usd }
      : null,
  }
}

export function getRecentAgentRunsWithCost(
  db: Database.Database,
  limit = 20
): AgentRunCostRow[] {
  const rows = db.prepare(`
    SELECT
      ar.id,
      ar.task,
      ar.repo,
      ar.status,
      ar.cost_usd,
      ar.tokens_in,
      ar.tokens_out,
      ar.cache_read,
      ar.cache_create,
      ar.duration_ms,
      ar.num_turns,
      ar.started_at,
      ar.finished_at,
      NULL as pr_url
    FROM agent_runs ar
    WHERE ar.status IN ('done', 'failed')
    ORDER BY ar.started_at DESC
    LIMIT ?
  `).all(limit) as AgentRunCostDbRow[]

  return rows.map((r) => ({
    id: r.id,
    task: r.task ?? '',
    repo: r.repo ?? '',
    status: r.status,
    cost_usd: r.cost_usd,
    tokens_in: r.tokens_in,
    tokens_out: r.tokens_out,
    cache_read: r.cache_read,
    cache_create: r.cache_create,
    duration_ms: r.duration_ms,
    num_turns: r.num_turns,
    started_at: r.started_at,
    finished_at: r.finished_at,
    pr_url: r.pr_url,
  }))
}
