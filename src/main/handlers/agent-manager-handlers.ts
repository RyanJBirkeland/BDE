/**
 * Agent manager IPC handlers — delegates to the in-process AgentManager.
 */
import { safeHandle } from '../ipc-utils'
import type { AgentManager } from '../agent-manager'
import type { AgentManagerStatus } from '../../shared/types'

const STOPPED_STATUS: AgentManagerStatus = {
  running: false,
  shuttingDown: false,
  concurrency: {
    maxSlots: 0,
    effectiveSlots: 0,
    activeCount: 0,
    recoveryDueAt: null,
    consecutiveRateLimits: 0,
    atFloor: false
  },
  activeAgents: []
}

export function registerAgentManagerHandlers(am: AgentManager | undefined): void {
  safeHandle('agent-manager:status', async () => {
    if (!am) return STOPPED_STATUS
    return am.getStatus()
  })

  safeHandle('agent-manager:kill', async (_e, taskId: string) => {
    if (!am) throw new Error('Agent manager not available')
    am.killAgent(taskId)
    return { ok: true }
  })

  safeHandle('agent-manager:metrics', async () => {
    return am?.getMetrics() ?? null
  })
}
