import { useCallback, useMemo, useState } from 'react'
import { AgentRow } from './AgentRow'
import type { UnifiedAgent } from '../../stores/unifiedAgents'
import { useUnifiedAgents, groupUnifiedAgents } from '../../stores/unifiedAgents'

export interface AgentListProps {
  query: string
  selectedId: string | null
  onSelect: (id: string) => void
  onKill: (agent: UnifiedAgent) => void
  onSteer: (agent: UnifiedAgent) => void
}

const HISTORY_LIMIT = 20

export function AgentList({
  query,
  selectedId,
  onSelect,
  onKill,
  onSteer
}: AgentListProps): React.JSX.Element {
  const agents = useUnifiedAgents()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [followMode, setFollowMode] = useState(true)

  const toggleHistory = useCallback(() => setHistoryOpen((v) => !v), [])
  const toggleFollow = useCallback(() => setFollowMode((v) => !v), [])

  const trimmedQuery = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!trimmedQuery) return null
    return agents.filter(
      (a) =>
        a.label.toLowerCase().includes(trimmedQuery) ||
        (a.task && a.task.toLowerCase().includes(trimmedQuery))
    )
  }, [agents, trimmedQuery])

  // Flat search results mode
  if (filtered !== null) {
    if (filtered.length === 0) {
      return (
        <div className="agent-list">
          <div className="agent-list__empty">No agents match &ldquo;{query.trim()}&rdquo;</div>
        </div>
      )
    }
    return (
      <div className="agent-list">
        {filtered.map((a) => (
          <AgentRow
            key={a.id}
            agent={a}
            isSelected={a.id === selectedId}
            onSelect={() => onSelect(a.id)}
            onKill={() => onKill(a)}
            onSteer={() => onSteer(a)}
          />
        ))}
      </div>
    )
  }

  const { active, recent, history } = groupUnifiedAgents(agents)

  // No agents at all
  if (active.length === 0 && recent.length === 0 && history.length === 0) {
    return (
      <div className="agent-list">
        <div className="agent-list__empty">No agents running. Click + Spawn to start one.</div>
      </div>
    )
  }

  const killableActive = active.filter((a) => a.canKill)
  const historyVisible = historyOpen ? history.slice(0, HISTORY_LIMIT) : []

  return (
    <div className="agent-list">
      {/* ACTIVE */}
      <div className="agent-list__section">
        <div className="agent-list__section-header">
          <span className="agent-list__section-title">ACTIVE ({active.length})</span>
          <button
            className="agent-list__follow-toggle"
            onClick={toggleFollow}
            title={followMode ? 'Auto-follow ON — click to unpin' : 'Auto-follow OFF — click to pin'}
          >
            {followMode ? '\uD83D\uDCCC' : '\uD83D\uDCCC'}
          </button>
          {killableActive.length > 1 && (
            <button
              className="agent-list__kill-all"
              onClick={() => killableActive.forEach((a) => onKill(a))}
            >
              ⛔ Kill All
            </button>
          )}
        </div>
        {active.map((a) => (
          <AgentRow
            key={a.id}
            agent={a}
            isSelected={a.id === selectedId}
            onSelect={() => onSelect(a.id)}
            onKill={() => onKill(a)}
            onSteer={() => onSteer(a)}
          />
        ))}
      </div>

      {/* RECENT */}
      {recent.length > 0 && (
        <div className="agent-list__section">
          <div className="agent-list__section-header">
            <span className="agent-list__section-title">RECENT ({recent.length})</span>
          </div>
          {recent.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              isSelected={a.id === selectedId}
              onSelect={() => onSelect(a.id)}
              onKill={() => onKill(a)}
              onSteer={() => onSteer(a)}
            />
          ))}
        </div>
      )}

      {/* HISTORY */}
      {history.length > 0 && (
        <div className="agent-list__section">
          <div className="agent-list__section-header" onClick={toggleHistory}>
            <span className="agent-list__section-title">
              {historyOpen ? '▾' : '▸'} HISTORY ({history.length})
            </span>
          </div>
          {historyOpen && (
            <>
              {historyVisible.map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  isSelected={a.id === selectedId}
                  onSelect={() => onSelect(a.id)}
                  onKill={() => onKill(a)}
                  onSteer={() => onSteer(a)}
                />
              ))}
              {history.length > HISTORY_LIMIT && (
                <button className="agent-list__view-all">
                  View all →
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
