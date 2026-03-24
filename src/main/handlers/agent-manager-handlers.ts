/**
 * Agent manager IPC handlers — delegates to the in-process AgentManager.
 */
import { safeHandle } from '../ipc-utils'
import type { AgentManager } from '../agent-manager'

export function registerAgentManagerHandlers(am: AgentManager | undefined): void {
  safeHandle('agent-manager:status', async () => {
    if (!am) return { running: false, concurrency: null, activeAgents: [] }
    // Cast needed: AgentManagerStatus.concurrency shape differs from IPC channel type.
    // This mismatch predates DI — preserving existing runtime behavior.
    return am.getStatus() as any
  })

  safeHandle('agent-manager:kill', async (_e, taskId: string) => {
    if (!am) throw new Error('Agent manager not available')
    am.killAgent(taskId)
    return { ok: true }
  })
}
