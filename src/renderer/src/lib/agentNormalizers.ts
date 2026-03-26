/**
 * Shared agent normalization utilities — used by both the useUnifiedAgents hook
 * and the useUnifiedAgentsStore Zustand store.
 *
 * Single source of truth for converting raw process/history data
 * into UnifiedAgent objects.
 */
import type {
  UnifiedAgent,
  LocalAgent,
  HistoryAgent,
  UnifiedAgentSource,
  UnifiedAgentStatus
} from '../../../shared/types'
import type { LocalAgentProcess } from '../stores/localAgents'
import type { AgentMeta } from '../../../shared/types'

export function normalizeStatus(raw: string | undefined): UnifiedAgentStatus {
  switch (raw) {
    case 'running':
      return 'running'
    case 'done':
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'timeout':
      return 'timeout'
    default:
      return 'unknown'
  }
}

export function normalizeSource(raw: string): UnifiedAgentSource {
  switch (raw) {
    case 'bde':
      return 'local'
    default:
      return 'history'
  }
}

export function truncateTask(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined
  return s.length > max ? s.slice(0, max) : s
}

export function safeTimestamp(value: string | number | null | undefined): number {
  if (value == null) return 0
  if (typeof value === 'number') return value
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * Build a unified agent list from local processes and history.
 */
export function buildUnifiedAgentList(
  processes: LocalAgentProcess[],
  historyAgents: AgentMeta[]
): UnifiedAgent[] {
  const agents: UnifiedAgent[] = []

  // Local running processes
  for (const p of processes) {
    const label = p.cwd ? (p.cwd.split('/').pop() ?? p.bin) : p.bin
    const local: LocalAgent = {
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
    }
    agents.push(local)
  }

  // History agents (all statuses)
  const localPids = new Set(processes.map((p) => p.pid))
  for (const a of historyAgents) {
    const started = safeTimestamp(a.startedAt)
    const finished = safeTimestamp(a.finishedAt)
    const isRunning = a.status === 'running'
    // Skip if already represented by a live ps-aux process row
    if (isRunning && a.pid && localPids.has(a.pid)) continue

    const source = normalizeSource(a.source)
    if (source === 'local') {
      // History entry from a BDE-spawned agent — treat as local
      const local: LocalAgent = {
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
        task: truncateTask(a.task, 80),
        pid: a.pid ?? 0
      }
      agents.push(local)
    } else {
      const history: HistoryAgent = {
        id: `history:${a.id}`,
        label: a.repo || a.bin || a.id,
        source: 'history',
        status: normalizeStatus(a.status),
        model: a.model ?? '',
        updatedAt: finished || started,
        startedAt: started,
        historyId: a.id
      }
      agents.push(history)
    }
  }

  return agents
}
