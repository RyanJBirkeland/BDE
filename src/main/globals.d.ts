import type { AgentManager } from './agent-manager/index'

declare global {
  // eslint-disable-next-line no-var
  var __agentManager: AgentManager | undefined
}
