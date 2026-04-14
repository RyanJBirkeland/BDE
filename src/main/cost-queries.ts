/**
 * Cost queries — thin wrapper that delegates to data/cost-queries.ts.
 * Preserves the original API surface for existing callers.
 */
import { getDb } from './db'
import {
  getCostSummary as _getCostSummary,
  getRecentAgentRunsWithCost as _getRecentAgentRunsWithCost,
  getAgentHistory as _getAgentHistory
} from './data/cost-queries'
import type { AgentRunCostRow, AgentRunSummary, AgentCostRecord, CostSummary } from '../shared/types'

export type { AgentRunCostRow, AgentRunSummary, AgentCostRecord, CostSummary }

export function getCostSummary(): CostSummary {
  return _getCostSummary(getDb())
}

export function getRecentAgentRunsWithCost(limit = 20): AgentRunSummary[] {
  return _getRecentAgentRunsWithCost(getDb(), limit)
}

export function getAgentHistory(limit = 100, offset = 0): AgentCostRecord[] {
  return _getAgentHistory(getDb(), limit, offset)
}
