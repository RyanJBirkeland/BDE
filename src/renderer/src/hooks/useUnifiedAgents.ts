/**
 * Unified agents derived hook — merges sessions, sub-agents, local processes,
 * and agent history into a single flat list of UnifiedAgent objects.
 */
import { useMemo } from 'react'
import { useSessionsStore } from '../stores/sessions'
import { useLocalAgentsStore } from '../stores/localAgents'
import { useAgentHistoryStore } from '../stores/agentHistory'

export type AgentSource = 'openclaw' | 'sub-agent' | 'local'
export type AgentStatus = 'running' | 'done' | 'failed' | 'timeout' | 'unknown'

export interface UnifiedAgent {
  id: string
  label: string
  source: AgentSource
  status: AgentStatus
  model: string
  updatedAt: number
  startedAt: number
  canSteer: boolean
  canKill: boolean
  isBlocked?: boolean
  task?: string
  pid?: number
  sessionKey?: string
  historyId?: string
}

const FIVE_MINUTES = 5 * 60 * 1000
const ONE_HOUR = 60 * 60 * 1000
const ONE_DAY = 24 * ONE_HOUR
const SEVEN_DAYS = 7 * ONE_DAY

function truncate(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined
  return s.length > max ? s.slice(0, max) : s
}

function normalizeStatus(raw: string | undefined): AgentStatus {
  switch (raw) {
    case 'running':
      return 'running'
    case 'done':
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    case 'timeout':
      return 'timeout'
    default:
      return 'unknown'
  }
}

function safeTimestamp(value: string | number | null | undefined): number {
  if (value == null) return 0
  if (typeof value === 'number') return value
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

export function useUnifiedAgents(): UnifiedAgent[] {
  const sessions = useSessionsStore((s) => s.sessions)
  const subAgents = useSessionsStore((s) => s.subAgents)
  const processes = useLocalAgentsStore((s) => s.processes)
  const historyAgents = useAgentHistoryStore((s) => s.agents)

  return useMemo(() => {
    const now = Date.now()
    const agents: UnifiedAgent[] = []

    // OpenClaw sessions
    for (const s of sessions) {
      const isRunning = (s.updatedAt ?? 0) > now - FIVE_MINUTES
      agents.push({
        id: s.key,
        label: s.displayName || s.key,
        source: 'openclaw',
        status: isRunning ? 'running' : 'done',
        model: s.model ?? '',
        updatedAt: s.updatedAt ?? 0,
        startedAt: s.updatedAt ?? 0,
        canSteer: true,
        canKill: isRunning,
        isBlocked: s.abortedLastRun === true && !isRunning,
        sessionKey: s.key
      })
    }

    // Sub-agents
    for (const a of subAgents) {
      agents.push({
        id: a.sessionKey,
        label: a.label || a.sessionKey,
        source: 'sub-agent',
        status: normalizeStatus(a.status),
        model: a.model ?? '',
        updatedAt: a.endedAt ?? a.startedAt ?? 0,
        startedAt: a.startedAt ?? 0,
        canSteer: !!a._isActive,
        canKill: !!a._isActive,
        isBlocked: false,
        task: truncate(a.task, 80),
        sessionKey: a.sessionKey
      })
    }

    // Local running processes
    for (const p of processes) {
      const label = p.cwd ? p.cwd.split('/').pop() ?? p.bin : p.bin
      agents.push({
        id: `local:${p.pid}`,
        label,
        source: 'local',
        status: 'running',
        model: '',
        updatedAt: p.startedAt ?? 0,
        startedAt: p.startedAt ?? 0,
        canSteer: false,
        canKill: true,
        isBlocked: false,
        pid: p.pid
      })
    }

    // History agents (all statuses — running ones shown with canKill)
    const localPids = new Set(processes.map((p) => p.pid))
    for (const a of historyAgents) {
      const started = safeTimestamp(a.startedAt)
      const finished = safeTimestamp(a.finishedAt)
      const isRunning = a.status === 'running'
      // Skip if already represented by a live ps-aux process row
      if (isRunning && a.pid && localPids.has(a.pid)) continue
      agents.push({
        id: `history:${a.id}`,
        label: a.repo || a.bin || a.id,
        source: 'local',
        status: normalizeStatus(a.status),
        model: a.model ?? '',
        updatedAt: finished || started,
        startedAt: started,
        canSteer: false,
        canKill: isRunning && !!a.pid,
        isBlocked: false,
        task: truncate(a.task, 80),
        historyId: a.id,
        pid: a.pid ?? undefined
      })
    }

    return agents
  }, [sessions, subAgents, processes, historyAgents])
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
