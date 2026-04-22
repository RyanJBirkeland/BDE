import { safeHandle } from '../ipc-utils'
import { getDb } from '../db'
import { getCostSummary, getRecentAgentRunsWithCost, getAgentHistory } from '../data/cost-queries'

export function registerCostHandlers(): void {
  safeHandle('cost:summary', () => getCostSummary(getDb()))
  safeHandle('cost:agentRuns', (_e, args: { limit?: number | undefined }) =>
    getRecentAgentRunsWithCost(getDb(), args.limit ?? 20)
  )
  type HistoryArgs = { limit?: number | undefined; offset?: number | undefined }
  safeHandle('cost:getAgentHistory', (_e, args?: HistoryArgs) => {
    return getAgentHistory(getDb(), args?.limit ?? 100, args?.offset ?? 0)
  })
}
