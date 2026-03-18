import { safeHandle } from '../ipc-utils'
import { getCostSummary, getRecentAgentRunsWithCost } from '../cost-queries'

export function registerCostHandlers(): void {
  safeHandle('cost:summary', () => getCostSummary())
  safeHandle('cost:agentRuns', (_e, args: { limit?: number }) =>
    getRecentAgentRunsWithCost(args.limit ?? 20)
  )
}
