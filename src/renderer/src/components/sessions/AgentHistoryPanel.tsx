import { useEffect, useState } from 'react'
import { useAgentHistoryStore } from '../../stores/agentHistory'
import type { AgentMeta } from '../../stores/agentHistory'
import { useLocalAgentsStore, LocalAgentProcess } from '../../stores/localAgents'
import { cwdToRepoLabel } from './LocalAgentRow'
import { Spinner } from '../ui/Spinner'
import { POLL_AGENTS_INTERVAL, AGENT_HISTORY_LIMIT } from '../../lib/constants'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatElapsed(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function statusIcon(status: AgentMeta['status']): string {
  if (status === 'done') return '\u2713'
  if (status === 'failed') return '\u2717'
  if (status === 'running') return '\u27F3'
  return '?'
}

function statusClass(status: AgentMeta['status']): string {
  if (status === 'done') return 'agent-history__status--done'
  if (status === 'failed') return 'agent-history__status--failed'
  if (status === 'running') return 'agent-history__status--running'
  return 'agent-history__status--unknown'
}

function taskPreview(task: string, maxLen = 32): string {
  const first = task.split('\n')[0] ?? task
  return first.length > maxLen ? first.slice(0, maxLen) + '\u2026' : first
}

function RunningAgentRow({
  proc,
  trackedId,
  onSelect,
  onImport,
  isSelected
}: {
  proc: LocalAgentProcess
  trackedId: string | null
  onSelect: () => void
  onImport: () => void
  isSelected: boolean
}): React.JSX.Element {
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const repoLabel = cwdToRepoLabel(proc.cwd)
  const elapsed = formatElapsed(proc.startedAt)

  return (
    <button
      className={`local-agent-row ${isSelected ? 'local-agent-row--selected' : ''}`}
      title={proc.args || undefined}
      onClick={onSelect}
    >
      <span className="local-agent-row__icon">{'\u2B21'}</span>
      <span className="local-agent-row__bin">{proc.bin}</span>
      <span className="local-agent-row__repo">~/{repoLabel}</span>
      <span className="local-agent-row__elapsed">{elapsed}</span>
      {!trackedId && (
        <span
          className="agent-history__import-btn"
          role="button"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onImport() }}
          title="Import to history"
        >
          {'\u2193'}
        </span>
      )}
      <span className="local-agent-row__pid">pid {proc.pid}</span>
    </button>
  )
}

function HistoryAgentRow({
  agent,
  isSelected,
  onSelect
}: {
  agent: AgentMeta
  isSelected: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      className={`local-agent-row ${isSelected ? 'local-agent-row--selected' : ''}`}
      title={agent.task}
      onClick={onSelect}
    >
      <span className={`agent-history__status-icon ${statusClass(agent.status)}`}>
        {statusIcon(agent.status)}
      </span>
      <span className="local-agent-row__bin">{agent.bin}</span>
      <span className="local-agent-row__repo">~/{agent.repo}</span>
      <span className="agent-history__task">{taskPreview(agent.task)}</span>
      <span className="local-agent-row__elapsed">{timeAgo(agent.startedAt)}</span>
    </button>
  )
}

export function AgentHistoryPanel({ query }: { query: string }): React.JSX.Element | null {
  const localProcesses = useLocalAgentsStore((s) => s.processes)
  const agents = useAgentHistoryStore((s) => s.agents)
  const isFetching = useAgentHistoryStore((s) => s.isFetching)
  const selectedId = useAgentHistoryStore((s) => s.selectedId)
  const selectAgent = useAgentHistoryStore((s) => s.selectAgent)
  const fetchAgents = useAgentHistoryStore((s) => s.fetchAgents)
  const importExternal = useAgentHistoryStore((s) => s.importExternal)
  const selectLocalAgent = useLocalAgentsStore((s) => s.selectLocalAgent)
  const selectedLocalPid = useLocalAgentsStore((s) => s.selectedLocalAgentPid)
  const localCollapsed = useLocalAgentsStore((s) => s.collapsed)
  const setLocalCollapsed = useLocalAgentsStore((s) => s.setCollapsed)

  const [historyExpanded, setHistoryExpanded] = useState(false)

  // Poll agent history every 10s
  useEffect(() => {
    fetchAgents()
    const interval = setInterval(fetchAgents, POLL_AGENTS_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchAgents])

  // Build a set of tracked PIDs (agents in history that are running)
  const trackedPids = new Map<number, string>()
  for (const a of agents) {
    if (a.pid && a.status === 'running') {
      trackedPids.set(a.pid, a.id)
    }
  }

  // Filter by search query
  const q = query.toLowerCase()
  const filteredLocal = localProcesses.filter((p) => {
    if (!q) return true
    return (
      p.bin.toLowerCase().includes(q) ||
      cwdToRepoLabel(p.cwd).toLowerCase().includes(q) ||
      String(p.pid).includes(q)
    )
  })

  const historyAgents = agents.filter((a) => a.status !== 'running')
  const filteredHistory = historyAgents.filter((a) => {
    if (!q) return true
    return (
      a.bin.toLowerCase().includes(q) ||
      a.repo.toLowerCase().includes(q) ||
      a.task.toLowerCase().includes(q) ||
      a.model.toLowerCase().includes(q)
    )
  })

  const displayedHistory = historyExpanded ? filteredHistory : filteredHistory.slice(0, AGENT_HISTORY_LIMIT)
  const hasMore = filteredHistory.length > AGENT_HISTORY_LIMIT

  const handleImport = (proc: LocalAgentProcess): void => {
    importExternal(
      {
        pid: proc.pid,
        bin: proc.bin,
        repo: cwdToRepoLabel(proc.cwd),
        repoPath: proc.cwd ?? '',
        startedAt: new Date(proc.startedAt).toISOString(),
        status: 'running',
        source: 'external'
      },
      '[Imported \u2014 output not captured]\n'
    )
  }

  const handleSelectRunning = (proc: LocalAgentProcess): void => {
    const trackedId = trackedPids.get(proc.pid)
    if (trackedId) {
      selectLocalAgent(null)
      selectAgent(trackedId)
    } else {
      selectAgent(null)
      selectLocalAgent(proc.pid)
    }
  }

  const handleSelectHistory = (agent: AgentMeta): void => {
    selectLocalAgent(null)
    selectAgent(agent.id)
  }

  if (isFetching && agents.length === 0 && filteredLocal.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
        <Spinner size="sm" />
      </div>
    )
  }

  if (filteredLocal.length === 0 && filteredHistory.length === 0) return null

  return (
    <>
      {filteredLocal.length > 0 && (
        <div className="session-list__group">
          <div className="session-list__group-header">
            <button
              className="local-agents__collapse-btn"
              onClick={() => setLocalCollapsed(!localCollapsed)}
            >
              <span className={`local-agents__chevron ${localCollapsed ? '' : 'local-agents__chevron--open'}`}>
                {'\u203A'}
              </span>
              <span className="session-list__group-label" style={{ padding: 0 }}>
                Local Agents — Running ({filteredLocal.length})
              </span>
            </button>
            <span className="local-agents__live-dot" title="Polling every 5s" />
          </div>
          {!localCollapsed &&
            filteredLocal.map((proc) => (
              <RunningAgentRow
                key={proc.pid}
                proc={proc}
                trackedId={trackedPids.get(proc.pid) ?? null}
                onSelect={() => handleSelectRunning(proc)}
                onImport={() => handleImport(proc)}
                isSelected={
                  selectedLocalPid === proc.pid ||
                  selectedId === trackedPids.get(proc.pid)
                }
              />
            ))}
        </div>
      )}

      {filteredHistory.length > 0 && (
        <div className="session-list__group">
          <div className="session-list__group-header">
            <span className="session-list__group-label">
              History ({filteredHistory.length} total)
            </span>
            {hasMore && (
              <button
                className="agent-history__view-all"
                onClick={() => setHistoryExpanded(!historyExpanded)}
              >
                {historyExpanded ? 'Show less' : 'View all \u2192'}
              </button>
            )}
          </div>
          {displayedHistory.map((agent) => (
            <HistoryAgentRow
              key={agent.id}
              agent={agent}
              isSelected={selectedId === agent.id}
              onSelect={() => handleSelectHistory(agent)}
            />
          ))}
        </div>
      )}
    </>
  )
}
