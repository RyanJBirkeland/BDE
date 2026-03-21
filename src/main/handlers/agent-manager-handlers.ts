import { safeHandle } from '../ipc-utils'
import type { AgentManager } from '../agent-manager'

export function registerAgentManagerHandlers(manager: AgentManager): void {
  safeHandle('agent-manager:status', async () => {
    return {
      activeCount: manager.activeCount,
      availableSlots: manager.availableSlots,
    }
  })

  safeHandle('agent-manager:kill', async (_e, taskId: string) => {
    return manager.killAgent(taskId)
  })
}
