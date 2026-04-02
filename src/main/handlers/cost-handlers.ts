import { safeHandle } from '../ipc-utils'
import { getCostSummary, getRecentAgentRunsWithCost, getAgentHistory } from '../cost-queries'

export function registerCostHandlers(): void {
  safeHandle('cost:summary', () => getCostSummary())
  safeHandle('cost:agentRuns', (_e, args: { limit?: number }) =>
    getRecentAgentRunsWithCost(args.limit ?? 20)
  )
  safeHandle('cost:getAgentHistory', (_e, args?: { limit?: number; offset?: number }) => {
    return getAgentHistory(args?.limit ?? 100, args?.offset ?? 0)
  })
}
