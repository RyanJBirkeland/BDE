import type { AgentEvent } from '../../../shared/types'

export function subscribeToAgentEvents(
  handler: (payload: { agentId: string; event: AgentEvent }) => void
): () => void {
  return window.api.agents.events.onEvent(handler)
}

export async function getAgentEventHistory(agentId: string): Promise<AgentEvent[]> {
  return window.api.agents.events.getHistory(agentId)
}

export async function listAgents(
  opts: Parameters<typeof window.api.agents.list>[0]
): ReturnType<typeof window.api.agents.list> {
  return window.api.agents.list(opts)
}

export async function readAgentLog(
  params: Parameters<typeof window.api.agents.readLog>[0]
): ReturnType<typeof window.api.agents.readLog> {
  return window.api.agents.readLog(params)
}

export async function importAgent(
  params: Parameters<typeof window.api.agents.import>[0]
): ReturnType<typeof window.api.agents.import> {
  return window.api.agents.import(params)
}

export async function getProcesses(): ReturnType<typeof window.api.agents.getProcesses> {
  return window.api.agents.getProcesses()
}

export async function spawnLocal(
  args: Parameters<typeof window.api.agents.spawnLocal>[0]
): ReturnType<typeof window.api.agents.spawnLocal> {
  return window.api.agents.spawnLocal(args)
}

export function tailLog(
  params: Parameters<typeof window.api.agents.tailLog>[0]
): ReturnType<typeof window.api.agents.tailLog> {
  return window.api.agents.tailLog(params)
}
