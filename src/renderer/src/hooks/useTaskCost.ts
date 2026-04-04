import { useCostDataStore } from '../stores/costData'

interface TaskCost {
  costUsd: number | null
}

/**
 * Hook to look up agent execution cost for a task by its agent_run_id.
 * Returns null if no cost data is available.
 */
export function useTaskCost(agentRunId: string | null | undefined): TaskCost {
  const localAgents = useCostDataStore((s) => s.localAgents)

  if (!agentRunId) {
    return { costUsd: null }
  }

  const agentRecord = localAgents.find((agent) => agent.id === agentRunId)
  return { costUsd: agentRecord?.costUsd ?? null }
}
