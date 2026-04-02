/**
 * Unified agents derived hook — merges local processes and agent history
 * into a single flat list of UnifiedAgent objects.
 *
 * Re-exports the shared UnifiedAgent type from shared/types.ts.
 */
import { useMemo } from 'react'
import { useLocalAgentsStore } from '../stores/localAgents'
import { useAgentHistoryStore } from '../stores/agentHistory'
import type {
  UnifiedAgent,
  LocalAgent,
  HistoryAgent,
  UnifiedAgentSource,
  UnifiedAgentStatus
} from '../../../shared/types'
import { buildUnifiedAgentList } from '../lib/agentNormalizers'

export type { UnifiedAgent, LocalAgent, HistoryAgent, UnifiedAgentSource, UnifiedAgentStatus }

const ONE_HOUR = 60 * 60 * 1000
const ONE_DAY = 24 * ONE_HOUR
const SEVEN_DAYS = 7 * ONE_DAY

export function useUnifiedAgents(): UnifiedAgent[] {
  const processes = useLocalAgentsStore((s) => s.processes)
  const historyAgents = useAgentHistoryStore((s) => s.agents)

  return useMemo(() => buildUnifiedAgentList(processes, historyAgents), [processes, historyAgents])
}

export function groupUnifiedAgents(agents: UnifiedAgent[]): {
  active: UnifiedAgent[]
  recent: UnifiedAgent[]
  history: UnifiedAgent[]
} {
  const now = Date.now()
  const active: UnifiedAgent[] = []
  const recent: UnifiedAgent[] = []
  const history: UnifiedAgent[] = []

  for (const a of agents) {
    if (a.status === 'running') {
      active.push(a)
    } else if (a.updatedAt > now - ONE_DAY) {
      recent.push(a)
    } else {
      history.push(a)
    }
  }

  active.sort((a, b) => b.startedAt - a.startedAt)
  recent.sort((a, b) => b.updatedAt - a.updatedAt)
  history.sort((a, b) => b.updatedAt - a.updatedAt)

  return { active, recent, history }
}

export function getStaleLevel(agent: UnifiedAgent): 'fresh' | 'aging' | 'stale' | 'dead' {
  const age = Date.now() - agent.updatedAt
  if (age < ONE_HOUR) return 'fresh'
  if (age < ONE_DAY) return 'aging'
  if (age < SEVEN_DAYS) return 'stale'
  return 'dead'
}
