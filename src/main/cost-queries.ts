/**
 * Cost queries — thin wrapper that delegates to data/cost-queries.ts.
 * Preserves the original API surface for existing callers.
 */
import type Database from 'better-sqlite3'
import { getDb } from './db'
import {
  getCostSummary as _getCostSummary,
  getRecentAgentRunsWithCost as _getRecentAgentRunsWithCost,
  getAgentHistory as _getAgentHistory
} from './data/cost-queries'
import type {
  AgentRunCostRow,
  AgentRunSummary,
  AgentCostRecord,
  CostSummary
} from '../shared/types'

export type { AgentRunCostRow, AgentRunSummary, AgentCostRecord, CostSummary }

export function getCostSummary(db?: Database.Database): CostSummary {
  return _getCostSummary(db ?? getDb())
}

export function getRecentAgentRunsWithCost(limit = 20, db?: Database.Database): AgentRunSummary[] {
  return _getRecentAgentRunsWithCost(db ?? getDb(), limit)
}

export function getAgentHistory(
  limit = 100,
  offset = 0,
  db?: Database.Database
): AgentCostRecord[] {
  return _getAgentHistory(db ?? getDb(), limit, offset)
}
