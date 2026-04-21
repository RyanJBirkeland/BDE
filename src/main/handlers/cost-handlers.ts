import { safeHandle } from '../ipc-utils'
import { getCostSummary, getRecentAgentRunsWithCost, getAgentHistory } from '../cost-queries'

export function registerCostHandlers(): void {
  safeHandle('cost:summary', () => getCostSummary())
  safeHandle('cost:agentRuns', (_e, args: { limit?: number | undefined }) =>
    getRecentAgentRunsWithCost(args.limit ?? 20)
  )
  type HistoryArgs = { limit?: number | undefined; offset?: number | undefined }
  safeHandle('cost:getAgentHistory', (_e, args?: HistoryArgs) => {
    return getAgentHistory(args?.limit ?? 100, args?.offset ?? 0)
  })
}
