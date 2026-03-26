/**
 * AgentList — left panel showing agents grouped by status.
 * Running agents appear first with live pulse, followed by recent (24h)
 * and history (older).
 */
import { useMemo, useState } from 'react'
import { Search, ChevronRight } from 'lucide-react'
import type { AgentMeta } from '../../../../shared/types'
import { tokens } from '../../design-system/tokens'
import { AgentCard } from './AgentCard'
import { neonVar } from '../neon/types'

interface AgentListProps {
  agents: AgentMeta[]
  selectedId: string | null
  onSelect: (id: string) => void
  filter?: string
  loading?: boolean
}

export interface AgentGroups {
  running: AgentMeta[]
  recent: AgentMeta[]
  history: AgentMeta[]
}

const RECENT_THRESHOLD_MS = 24 * 60 * 60 * 1000

export function groupAgents(agents: AgentMeta[]): AgentGroups {
  const now = Date.now()
  const running: AgentMeta[] = []
  const recent: AgentMeta[] = []
  const history: AgentMeta[] = []

  for (const agent of agents) {
    if (agent.status === 'running') {
      running.push(agent)
    } else {
      const finishedMs = agent.finishedAt ? new Date(agent.finishedAt).getTime() : 0
      if (now - finishedMs < RECENT_THRESHOLD_MS) {
        recent.push(agent)
      } else {
        history.push(agent)
      }
    }
  }

  return { running, recent, history }
}

function GroupHeader({
  label,
  count,
  open,
  onToggle,
  showPulse
}: {
  label: string
  count: number
  open: boolean
  onToggle: () => void
  showPulse?: boolean
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[2],
        width: '100%',
        padding: `${tokens.space[1]} ${tokens.space[3]}`,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: neonVar('purple', 'color'),
        fontSize: tokens.size.xs,
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
      }}
    >
      <ChevronRight
        size={12}
        style={{
          transform: open ? 'rotate(90deg)' : undefined,
          transition: tokens.transition.fast
        }}
      />
      {showPulse && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: tokens.radius.full,
            background: neonVar('cyan', 'color'),
            boxShadow: `0 0 8px ${neonVar('cyan', 'glow')}`,
            animation: 'pulse 2s infinite'
          }}
        />
      )}
      {label}
      <span style={{ color: tokens.color.textDim }}>({count})</span>
    </button>
  )
}

export function AgentList({ agents, selectedId, onSelect, filter, loading }: AgentListProps) {
  const [searchText, setSearchText] = useState(filter ?? '')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)

  const filtered = useMemo(() => {
    if (!searchText) return agents
    const lower = searchText.toLowerCase()
    return agents.filter(
      (a) =>
        a.task.toLowerCase().includes(lower) ||
        a.repo.toLowerCase().includes(lower) ||
        a.model.toLowerCase().includes(lower)
    )
  }, [agents, searchText])

  const groups = useMemo(() => groupAgents(filtered), [filtered])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: `linear-gradient(180deg, rgba(88, 28, 135, 0.1) 0%, rgba(10, 0, 21, 0.6) 100%)`,
        backdropFilter: 'var(--neon-glass-blur)',
        WebkitBackdropFilter: 'var(--neon-glass-blur)'
      }}
    >
      {/* Search */}
      <div
        style={{
          padding: tokens.space[2],
          borderBottom: `1px solid ${neonVar('purple', 'border')}`
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[2],
            padding: `${tokens.space[1]} ${tokens.space[2]}`,
            background: 'rgba(10, 0, 21, 0.4)',
            borderRadius: tokens.radius.sm,
            border: searchFocused
              ? `1px solid ${neonVar('purple', 'color')}`
              : `1px solid ${tokens.color.border}`,
            boxShadow: searchFocused ? `0 0 12px ${neonVar('purple', 'glow')}` : 'none',
            transition: tokens.transition.fast
          }}
        >
          <Search
            size={12}
            color={searchFocused ? neonVar('purple', 'color') : tokens.color.textDim}
          />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Filter agents..."
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              color: tokens.color.text,
              fontSize: tokens.size.sm,
              outline: 'none'
            }}
          />
        </div>
      </div>

      {/* Agent groups */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && agents.length === 0 && (
          <div
            style={{
              padding: tokens.space[2],
              display: 'flex',
              flexDirection: 'column',
              gap: tokens.space[2]
            }}
          >
            <div className="bde-skeleton" style={{ height: 56 }} />
            <div className="bde-skeleton" style={{ height: 56 }} />
            <div className="bde-skeleton" style={{ height: 56 }} />
            <div className="bde-skeleton" style={{ height: 56 }} />
          </div>
        )}

        {groups.running.length > 0 && (
          <div>
            <GroupHeader
              label="Running"
              count={groups.running.length}
              open
              onToggle={() => {}}
              showPulse
            />
            {groups.running.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                selected={a.id === selectedId}
                onClick={() => onSelect(a.id)}
              />
            ))}
          </div>
        )}

        {groups.recent.length > 0 && (
          <div>
            <GroupHeader
              label="Recent"
              count={groups.recent.length}
              open
              onToggle={() => {}}
              showPulse={false}
            />
            {groups.recent.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                selected={a.id === selectedId}
                onClick={() => onSelect(a.id)}
              />
            ))}
          </div>
        )}

        {groups.history.length > 0 && (
          <div>
            <GroupHeader
              label="History"
              count={groups.history.length}
              open={historyOpen}
              onToggle={() => setHistoryOpen((v) => !v)}
            />
            {historyOpen &&
              groups.history.map((a) => (
                <AgentCard
                  key={a.id}
                  agent={a}
                  selected={a.id === selectedId}
                  onClick={() => onSelect(a.id)}
                />
              ))}
          </div>
        )}

        {filtered.length === 0 && (
          <div
            style={{
              padding: tokens.space[4],
              textAlign: 'center',
              color: tokens.color.textDim,
              fontSize: tokens.size.sm
            }}
          >
            No agents found
          </div>
        )}
      </div>
    </div>
  )
}
