/**
 * Cost queries — thin wrapper that delegates to data/cost-queries.ts.
 * Preserves the original API surface for existing callers.
 */
import { getDb } from './db'
import {
  getCostSummary as _getCostSummary,
  getRecentAgentRunsWithCost as _getRecentAgentRunsWithCost,
} from './data/cost-queries'
import type { AgentRunCostRow, CostSummary } from '../shared/types'

export type { AgentRunCostRow, CostSummary }

export function getCostSummary(): CostSummary {
  return _getCostSummary(getDb())
}

export function getRecentAgentRunsWithCost(limit = 20): AgentRunCostRow[] {
  return _getRecentAgentRunsWithCost(getDb(), limit)
}
