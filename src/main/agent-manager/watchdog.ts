import type { ActiveAgent, AgentManagerConfig } from './types'
import { RATE_LIMIT_LOOP_THRESHOLD } from './types'

export type WatchdogVerdict =
  | 'ok'
  | 'idle'
  | 'max-runtime'
  | 'rate-limit-loop'
  | 'cost-budget-exceeded'

export function checkAgent(
  agent: ActiveAgent,
  now: number,
  config: AgentManagerConfig
): WatchdogVerdict {
  const maxRuntime = agent.maxRuntimeMs ?? config.maxRuntimeMs
  if (now - agent.startedAt >= maxRuntime) return 'max-runtime'
  if (now - agent.lastOutputAt >= config.idleTimeoutMs) return 'idle'
  if (agent.rateLimitCount >= RATE_LIMIT_LOOP_THRESHOLD) return 'rate-limit-loop'
  if (agent.maxCostUsd !== null && agent.costUsd >= agent.maxCostUsd) return 'cost-budget-exceeded'
  return 'ok'
}
