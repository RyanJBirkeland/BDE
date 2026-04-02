/**
 * AgentList — left panel showing agents grouped by status.
 * Running agents appear first with live pulse, followed by recent (24h)
 * and history (older).
 */
import { useMemo, useState, useRef, useEffect } from 'react'
import { Search, ChevronRight } from 'lucide-react'
import type { AgentMeta } from '../../../../shared/types'
import { tokens } from '../../design-system/tokens'
import { AgentCard } from './AgentCard'
import { neonVar } from '../neon/types'

interface AgentListProps {
  agents: AgentMeta[]
  selectedId: string | null
  onSelect: (id: string) => void
  onKill?: () => void
  filter?: string
  loading?: boolean
  fetchError?: string | null
  onRetry?: () => void
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
  showPulse,
  collapsible = true
}: {
  label: string
  count: number
  open: boolean
  onToggle: () => void
  showPulse?: boolean
  collapsible?: boolean
}) {
  const Tag = collapsible ? 'button' : 'div'
  return (
    <Tag
      {...(collapsible ? { onClick: onToggle } : {})}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[2],
        width: '100%',
        padding: `${tokens.space[1]} ${tokens.space[3]}`,
        background: 'none',
        border: 'none',
        cursor: collapsible ? 'pointer' : 'default',
        color: neonVar('purple', 'color'),
        fontSize: tokens.size.xs,
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
      }}
    >
      {collapsible && (
        <ChevronRight
          size={12}
          style={{
            transform: open ? 'rotate(90deg)' : undefined,
            transition: tokens.transition.fast
          }}
        />
      )}
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
    </Tag>
  )
}

export function AgentList({ agents, selectedId, onSelect, onKill, filter, loading, fetchError, onRetry }: AgentListProps) {
  const [searchText, setSearchText] = useState(filter ?? '')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const selectedRef = useRef<HTMLDivElement>(null)

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

  // Scroll selected agent into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedId])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: `linear-gradient(180deg, var(--neon-purple-surface, rgba(88,28,135,0.1)) 0%, var(--neon-surface-deep, rgba(10,0,21,0.6)) 100%)`,
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
            background: 'var(--neon-surface-deep, rgba(10,0,21,0.4))',
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
            aria-label="Filter agents"
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
        {fetchError && agents.length === 0 && (
          <div
            style={{
              padding: tokens.space[4],
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: tokens.space[2]
            }}
          >
            <span style={{ color: neonVar('red', 'color'), fontSize: tokens.size.sm }}>
              {fetchError}
            </span>
            {onRetry && (
              <button
                onClick={onRetry}
                style={{
                  padding: `${tokens.space[1]} ${tokens.space[3]}`,
                  background: 'var(--neon-surface-deep, rgba(10,0,21,0.4))',
                  border: `1px solid ${neonVar('cyan', 'border')}`,
                  borderRadius: tokens.radius.sm,
                  color: neonVar('cyan', 'color'),
                  fontSize: tokens.size.xs,
                  cursor: 'pointer'
                }}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {fetchError && agents.length > 0 && (
          <div
            style={{
              padding: `${tokens.space[1]} ${tokens.space[2]}`,
              background: neonVar('orange', 'surface'),
              borderBottom: `1px solid ${neonVar('orange', 'border')}`,
              color: neonVar('orange', 'color'),
              fontSize: tokens.size.xs,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span>Refresh failed — showing cached list</span>
            {onRetry && (
              <button
                onClick={onRetry}
                style={{
                  background: 'none',
                  border: 'none',
                  color: neonVar('orange', 'color'),
                  cursor: 'pointer',
                  fontSize: tokens.size.xs,
                  textDecoration: 'underline',
                  padding: 0
                }}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {loading && agents.length === 0 && !fetchError && (
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
              collapsible={false}
            />
            {groups.running.map((a) => (
              <div key={a.id} ref={a.id === selectedId ? selectedRef : null}>
                <AgentCard
                  agent={a}
                  selected={a.id === selectedId}
                  onClick={() => onSelect(a.id)}
                  onKill={onKill}
                />
              </div>
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
              collapsible={false}
            />
            {groups.recent.map((a) => (
              <div key={a.id} ref={a.id === selectedId ? selectedRef : null}>
                <AgentCard
                  agent={a}
                  selected={a.id === selectedId}
                  onClick={() => onSelect(a.id)}
                  onKill={onKill}
                />
              </div>
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
                <div key={a.id} ref={a.id === selectedId ? selectedRef : null}>
                  <AgentCard
                    agent={a}
                    selected={a.id === selectedId}
                    onClick={() => onSelect(a.id)}
                    onKill={onKill}
                  />
                </div>
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
