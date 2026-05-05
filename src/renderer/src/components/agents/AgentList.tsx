/**
 * AgentList — V2 banded layout.
 * Header band (eyebrow + count + spawn) → composition strip → filter chips →
 * search → ScratchpadBanner → scrollable grouped rows.
 */
import { useMemo, useState, useRef, useEffect } from 'react'
import { Search } from 'lucide-react'
import './AgentList.css'
import type { AgentMeta } from '../../../../shared/types'
import { AgentRow } from './AgentRow'
import { ScratchpadBanner } from './ScratchpadBanner'

// ─── Public types ──────────────────────────────────────────────────────────────

export interface AgentGroups {
  running: AgentMeta[]
  recent: AgentMeta[]
  history: AgentMeta[]
}

type StatusFilter = 'all' | 'live' | 'review' | 'failed' | 'done'

interface AgentListProps {
  agents: AgentMeta[]
  selectedId: string | null
  onSelect: (id: string) => void
  onSpawn: () => void
  onKill?: (() => void) | undefined
  filter?: string | undefined
  loading?: boolean | undefined
  fetchError?: string | null | undefined
  onRetry?: (() => void) | undefined
  displayedCount?: number | undefined
  /** V1 compat — no-op in V2 */
  hasMore?: boolean | undefined
  /** V1 compat — no-op in V2 */
  onLoadMore?: (() => void) | undefined
  showBanner?: boolean | undefined
  onDismissBanner?: (() => void) | undefined
}

// ─── Grouping logic (exported — tests import this directly) ───────────────────

const RECENT_THRESHOLD_MS = 24 * 60 * 60 * 1000

// eslint-disable-next-line react-refresh/only-export-components
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function CompositionStrip({ agents }: { agents: AgentMeta[] }): React.JSX.Element | null {
  const counts = useMemo(() => {
    const map: Partial<Record<string, number>> = {}
    for (const a of agents) {
      map[a.status] = (map[a.status] ?? 0) + 1
    }
    return map
  }, [agents])

  const relevantStatuses = ['running', 'review', 'done', 'failed'] as const
  const segments = relevantStatuses.filter((s) => (counts[s] ?? 0) > 0)

  if (segments.length === 0) return null

  return (
    <div
      style={{
        height: 4,
        display: 'flex',
        overflow: 'hidden',
        borderRadius: 999,
        margin: 'var(--s-2) var(--s-4) 0',
      }}
    >
      {segments.map((status) => (
        <div
          key={status}
          style={{
            flex: counts[status],
            background: `var(--st-${status})`,
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  )
}

function FilterChips({
  agents,
  activeFilter,
  onFilterChange,
}: {
  agents: AgentMeta[]
  activeFilter: StatusFilter
  onFilterChange: (f: StatusFilter) => void
}): React.JSX.Element {
  const counts = useMemo(() => {
    // Cast to string to accommodate any status values beyond the core union
    // (e.g. 'review', 'error' from pipeline agent flows)
    const statusOf = (a: AgentMeta): string => a.status as string
    const live = agents.filter((a) => statusOf(a) === 'running').length
    const review = agents.filter((a) => statusOf(a) === 'review').length
    const failed = agents.filter((a) => statusOf(a) === 'failed' || statusOf(a) === 'error').length
    const done = agents.filter((a) => statusOf(a) === 'done').length
    return { live, review, failed, done }
  }, [agents])

  const chips: { key: StatusFilter; label: string; count: number; status?: string }[] = [
    { key: 'all', label: 'all', count: agents.length },
    { key: 'live', label: 'live', count: counts.live, status: 'running' },
    { key: 'review', label: 'review', count: counts.review, status: 'review' },
    { key: 'failed', label: 'failed', count: counts.failed, status: 'failed' },
    { key: 'done', label: 'done', count: counts.done, status: 'done' },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--s-1)',
        padding: 'var(--s-2) var(--s-4)',
      }}
    >
      {chips.map(({ key, label, count, status }) => {
        const isActive = activeFilter === key
        return (
          <button
            key={key}
            aria-pressed={isActive}
            onClick={() => onFilterChange(key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-1)',
              padding: '3px var(--s-2)',
              background: isActive ? 'var(--surf-2)' : 'transparent',
              border: isActive ? '1px solid var(--line-2)' : '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
              color: isActive ? 'var(--fg)' : 'var(--fg-3)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              cursor: 'pointer',
              transition: 'all var(--dur-fast)',
            }}
          >
            {status && (
              <span
                className={`fleet-dot--${status}`}
                style={{ width: 5, height: 5, flexShrink: 0 }}
              />
            )}
            {label}
            <span style={{ color: isActive ? 'var(--fg-3)' : 'var(--fg-4)' }}>{count}</span>
          </button>
        )
      })}
    </div>
  )
}

function GroupLabel({ label }: { label: string }): React.JSX.Element {
  return (
    <div
      className="fleet-eyebrow"
      style={{
        padding: 'var(--s-2) var(--s-3) var(--s-1)',
        fontSize: 9,
        color: 'var(--fg-4)',
      }}
    >
      {label}
    </div>
  )
}

function SkeletonRows(): React.JSX.Element {
  return (
    <div
      className="agent-list__loading-container"
      style={{ padding: 'var(--s-2)', display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}
    >
      {[56, 56, 56, 56, 56].map((h, i) => (
        <div key={i} className="fleet-skeleton" style={{ height: h }} />
      ))}
    </div>
  )
}

function EmptyAgentState({ onSpawn }: { onSpawn: () => void }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--s-3)',
        padding: 'var(--s-7) var(--s-4)',
        textAlign: 'center',
      }}
    >
      <div className="fleet-eyebrow">EMPTY</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>No agents yet</div>
      <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Spawn one to get started.</div>
      <button
        onClick={onSpawn}
        style={{
          padding: '5px 14px',
          height: 26,
          background: 'var(--accent)',
          color: 'var(--accent-fg)',
          border: 'none',
          borderRadius: 'var(--r-md)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        + Spawn
      </button>
    </div>
  )
}

function ErrorState({
  error,
  onRetry,
}: {
  error: string
  onRetry?: (() => void) | undefined
}): React.JSX.Element {
  const message =
    error.length > 200 ? `${error.slice(0, 200)}… (see ~/.fleet/fleet.log for details)` : error

  return (
    <div
      style={{
        margin: 'var(--s-2)',
        padding: 'var(--s-3)',
        background: 'var(--surf-1)',
        border: '1px solid var(--st-failed)',
        borderRadius: 'var(--r-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-2)',
      }}
    >
      <div className="fleet-eyebrow" style={{ color: 'var(--st-failed)' }}>
        FETCH FAILED
      </div>
      <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            alignSelf: 'flex-start',
            padding: '3px 10px',
            background: 'transparent',
            border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-sm)',
            color: 'var(--fg-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AgentList({
  agents,
  selectedId,
  onSelect,
  onSpawn,
  filter,
  loading,
  fetchError,
  onRetry,
  displayedCount,
  // hasMore and onLoadMore are V1-compat props consumed by AgentsViewV1; unused in V2
  hasMore: _hasMore,
  onLoadMore: _onLoadMore,
  showBanner,
  onDismissBanner,
}: AgentListProps): React.JSX.Element {
  const [searchText, setSearchText] = useState(filter ?? '')
  const [searchFocused, setSearchFocused] = useState(false)
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('all')
  const selectedRef = useRef<HTMLDivElement>(null)

  const limitedAgents = displayedCount ? agents.slice(0, displayedCount) : agents

  const searchFiltered = useMemo(() => {
    if (!searchText) return limitedAgents
    const lower = searchText.toLowerCase()
    return limitedAgents.filter(
      (a) =>
        a.task.toLowerCase().includes(lower) ||
        a.repo.toLowerCase().includes(lower) ||
        a.model.toLowerCase().includes(lower)
    )
  }, [limitedAgents, searchText])

  const statusFiltered = useMemo(() => {
    if (activeFilter === 'all') return searchFiltered
    // Cast to string to handle status values beyond the core AgentMeta union
    const s = (a: AgentMeta): string => a.status as string
    if (activeFilter === 'live') return searchFiltered.filter((a) => s(a) === 'running')
    if (activeFilter === 'review') return searchFiltered.filter((a) => s(a) === 'review')
    if (activeFilter === 'failed')
      return searchFiltered.filter((a) => s(a) === 'failed' || s(a) === 'error')
    if (activeFilter === 'done') return searchFiltered.filter((a) => s(a) === 'done')
    return searchFiltered
  }, [searchFiltered, activeFilter])

  const groups = useMemo(() => groupAgents(statusFiltered), [statusFiltered])

  const visibleAgents = useMemo(
    () => [...groups.running, ...groups.recent, ...groups.history],
    [groups]
  )

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedId])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    if (visibleAgents.length === 0) return

    e.preventDefault()

    const currentIndex = visibleAgents.findIndex((a) => a.id === selectedId)
    let nextIndex: number

    if (currentIndex === -1) {
      nextIndex = 0
    } else if (e.key === 'ArrowDown') {
      nextIndex = Math.min(currentIndex + 1, visibleAgents.length - 1)
    } else {
      nextIndex = Math.max(currentIndex - 1, 0)
    }

    const nextAgent = visibleAgents[nextIndex]
    if (nextAgent) onSelect(nextAgent.id)
  }

  const showFilteredEmptyMessage =
    statusFiltered.length === 0 && agents.length > 0 && !loading && !fetchError

  const showEmptyState =
    agents.length === 0 && !loading && !fetchError

  return (
    <div className="agent-list">
      <HeaderBand agents={agents} onSpawn={onSpawn} />

      <FilterChips
        agents={searchFiltered}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
      />

      <SearchBand
        value={searchText}
        focused={searchFocused}
        onChange={setSearchText}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
      />

      {showBanner && (
        <ScratchpadBanner onDismiss={onDismissBanner ?? (() => undefined)} />
      )}

      <div
        role="listbox"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Agent list"
        style={{ flex: 1, overflowY: 'auto', outline: 'none', padding: '0 var(--s-2) var(--s-2)' }}
      >
        {fetchError && agents.length === 0 && (
          <ErrorState error={fetchError} onRetry={onRetry} />
        )}

        {fetchError && agents.length > 0 && (
          <div
            style={{
              padding: 'var(--s-1) var(--s-2)',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--surf-1)',
              borderBottom: '1px solid var(--line)',
              color: 'var(--fg-3)',
            }}
          >
            <span>Refresh failed — showing cached list</span>
            {onRetry && (
              <button
                onClick={onRetry}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 11,
                  color: 'var(--fg-3)',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {loading && agents.length === 0 && !fetchError && <SkeletonRows />}

        {showEmptyState && <EmptyAgentState onSpawn={onSpawn} />}

        {showFilteredEmptyMessage && (
          <div
            style={{
              padding: 'var(--s-4)',
              fontSize: 12,
              color: 'var(--fg-3)',
              textAlign: 'center',
            }}
          >
            No agents match your filter. Try adjusting the search or clearing filters.
          </div>
        )}

        {activeFilter === 'all' ? (
          <GroupedAgentRows groups={groups} selectedId={selectedId} onSelect={onSelect} selectedRef={selectedRef} />
        ) : (
          <FlatAgentRows agents={statusFiltered} selectedId={selectedId} onSelect={onSelect} selectedRef={selectedRef} />
        )}
      </div>
    </div>
  )
}

// ─── Layout bands ─────────────────────────────────────────────────────────────

function HeaderBand({
  agents,
  onSpawn,
}: {
  agents: AgentMeta[]
  onSpawn: () => void
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--s-3) var(--s-4)',
        gap: 'var(--s-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-2)' }}>
          <span className="fleet-eyebrow">FLEET</span>
          <span style={{ fontSize: 16, color: 'var(--fg)', fontWeight: 500 }}>
            {agents.length} agents
          </span>
        </div>
        <button
          onClick={onSpawn}
          style={{
            height: 26,
            padding: '0 10px',
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            border: 'none',
            borderRadius: 'var(--r-md)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + Spawn
        </button>
      </div>
      <CompositionStrip agents={agents} />
    </div>
  )
}

function SearchBand({
  value,
  focused,
  onChange,
  onFocus,
  onBlur,
}: {
  value: string
  focused: boolean
  onChange: (v: string) => void
  onFocus: () => void
  onBlur: () => void
}): React.JSX.Element {
  return (
    <div style={{ padding: '0 var(--s-2) var(--s-2)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          height: 28,
          padding: '0 var(--s-2)',
          background: 'var(--surf-1)',
          border: `1px solid ${focused ? 'var(--line-2)' : 'var(--line)'}`,
          borderRadius: 'var(--r-md)',
          transition: 'border-color var(--dur-fast)',
        }}
      >
        <Search size={12} style={{ color: focused ? 'var(--fg-2)' : 'var(--fg-4)', flexShrink: 0 }} />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="Filter agents..."
          aria-label="Filter agents"
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--fg)',
          }}
        />
      </div>
    </div>
  )
}

// ─── Agent row renderers ──────────────────────────────────────────────────────

function GroupedAgentRows({
  groups,
  selectedId,
  onSelect,
  selectedRef,
}: {
  groups: AgentGroups
  selectedId: string | null
  onSelect: (id: string) => void
  selectedRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  return (
    <>
      {groups.running.length > 0 && (
        <section>
          <GroupLabel label={`Live · ${groups.running.length}`} />
          {groups.running.map((agent) => (
            <AgentRowWrapper
              key={agent.id}
              agent={agent}
              selectedId={selectedId}
              onSelect={onSelect}
              selectedRef={selectedRef}
            />
          ))}
        </section>
      )}

      {(groups.recent.length > 0 || groups.history.length > 0) && (
        <section>
          <GroupLabel label="Recent" />
          {groups.recent.map((agent) => (
            <AgentRowWrapper
              key={agent.id}
              agent={agent}
              selectedId={selectedId}
              onSelect={onSelect}
              selectedRef={selectedRef}
            />
          ))}
          {groups.history.map((agent) => (
            <AgentRowWrapper
              key={agent.id}
              agent={agent}
              selectedId={selectedId}
              onSelect={onSelect}
              selectedRef={selectedRef}
            />
          ))}
        </section>
      )}
    </>
  )
}

function FlatAgentRows({
  agents,
  selectedId,
  onSelect,
  selectedRef,
}: {
  agents: AgentMeta[]
  selectedId: string | null
  onSelect: (id: string) => void
  selectedRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  return (
    <>
      {agents.map((agent) => (
        <AgentRowWrapper
          key={agent.id}
          agent={agent}
          selectedId={selectedId}
          onSelect={onSelect}
          selectedRef={selectedRef}
        />
      ))}
    </>
  )
}

function AgentRowWrapper({
  agent,
  selectedId,
  onSelect,
  selectedRef,
}: {
  agent: AgentMeta
  selectedId: string | null
  onSelect: (id: string) => void
  selectedRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  return (
    <div
      ref={agent.id === selectedId ? selectedRef : null}
      role="option"
      aria-selected={agent.id === selectedId}
      tabIndex={-1}
    >
      <AgentRow
        agent={agent}
        selected={agent.id === selectedId}
        onClick={() => onSelect(agent.id)}
      />
    </div>
  )
}
