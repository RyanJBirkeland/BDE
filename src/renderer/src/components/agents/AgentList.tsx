/**
 * AgentList — left panel showing agents grouped by status.
 * Running agents appear first with live pulse, followed by recent (24h)
 * and history (older).
 */
import { useMemo, useState, useRef, useEffect } from 'react'
import { Search, ChevronRight } from 'lucide-react'
import './AgentList.css'
import type { AgentMeta } from '../../../../shared/types'
import { EmptyState } from '../ui/EmptyState'
import { AgentCard } from './AgentCard'
import { neonVar } from '../neon/types'

interface AgentListProps {
  agents: AgentMeta[]
  selectedId: string | null
  onSelect: (id: string) => void
  onKill?: (() => void) | undefined
  filter?: string | undefined
  loading?: boolean | undefined
  fetchError?: string | null | undefined
  onRetry?: (() => void) | undefined
  displayedCount?: number | undefined
  hasMore?: boolean | undefined
  onLoadMore?: (() => void) | undefined
}

export interface AgentGroups {
  running: AgentMeta[]
  recent: AgentMeta[]
  history: AgentMeta[]
}

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
  showPulse?: boolean | undefined
  collapsible?: boolean | undefined
}): React.JSX.Element {
  const Tag = collapsible ? 'button' : 'div'
  return (
    <Tag
      {...(collapsible ? { onClick: onToggle } : {})}
      className={`agent-list__section-header ${!collapsible ? 'agent-list__section-header--static' : ''}`}
      style={{
        color: neonVar('purple', 'color')
      }}
    >
      {collapsible && (
        <ChevronRight
          size={12}
          className={`agent-list__section-chevron ${open ? 'agent-list__section-chevron--open' : ''}`}
        />
      )}
      {showPulse && (
        <span
          className="agent-list__section-pulse"
          style={{
            background: neonVar('cyan', 'color')
          }}
        />
      )}
      {label}
      <span className="agent-list__count-badge">({count})</span>
    </Tag>
  )
}

export function AgentList({
  agents,
  selectedId,
  onSelect,
  onKill,
  filter,
  loading,
  fetchError,
  onRetry,
  displayedCount,
  hasMore,
  onLoadMore
}: AgentListProps): React.JSX.Element {
  const [searchText, setSearchText] = useState(filter ?? '')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const selectedRef = useRef<HTMLDivElement>(null)

  const limitedAgents = displayedCount ? agents.slice(0, displayedCount) : agents

  const repos = useMemo(() => {
    const set = new Set(agents.map((a) => a.repo))
    return Array.from(set).sort()
  }, [agents])

  const filtered = useMemo(() => {
    let result = limitedAgents

    // Filter by repo first
    if (selectedRepo) {
      result = result.filter((a) => a.repo === selectedRepo)
    }

    // Then filter by search text
    if (searchText) {
      const lower = searchText.toLowerCase()
      result = result.filter(
        (a) =>
          a.task.toLowerCase().includes(lower) ||
          a.repo.toLowerCase().includes(lower) ||
          a.model.toLowerCase().includes(lower)
      )
    }

    return result
  }, [limitedAgents, searchText, selectedRepo])

  const groups = useMemo(() => groupAgents(filtered), [filtered])

  // Flat list of all visible agents for keyboard navigation
  const visibleAgents = useMemo(() => {
    const all = [...groups.running, ...groups.recent]
    if (historyOpen) {
      all.push(...groups.history)
    }
    return all
  }, [groups, historyOpen])

  // Scroll selected agent into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedId])

  // Handle arrow key navigation
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    if (visibleAgents.length === 0) return

    e.preventDefault()

    const currentIndex = visibleAgents.findIndex((a) => a.id === selectedId)
    let nextIndex: number

    if (currentIndex === -1) {
      // No selection, select first
      nextIndex = 0
    } else if (e.key === 'ArrowDown') {
      nextIndex = Math.min(currentIndex + 1, visibleAgents.length - 1)
    } else {
      nextIndex = Math.max(currentIndex - 1, 0)
    }

    const nextAgent = visibleAgents[nextIndex]
    if (nextAgent) onSelect(nextAgent.id)
  }

  return (
    <div className="agent-list">
      {/* Search */}
      <div className="agent-list__search-container">
        <div
          className={`agent-list__search-box ${
            searchFocused ? 'agent-list__search-border--focused' : 'agent-list__search-border'
          }`}
        >
          <Search
            size={12}
            className={
              searchFocused ? 'agent-list__search-icon--focused' : 'agent-list__search-icon'
            }
          />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Filter agents..."
            aria-label="Filter agents"
            className="agent-list__search-input agent-list__search-input-field"
          />
        </div>
      </div>

      {/* Repo filter chips */}
      {repos.length >= 2 && (
        <div className="agent-list__repo-chips">
          <button
            className={`agent-list__repo-chip ${!selectedRepo ? 'agent-list__repo-chip--active' : ''}`}
            onClick={() => setSelectedRepo(null)}
          >
            All
          </button>
          {repos.map((repo) => (
            <button
              key={repo}
              className={`agent-list__repo-chip ${selectedRepo === repo ? 'agent-list__repo-chip--active' : ''}`}
              onClick={() => setSelectedRepo(repo)}
            >
              {repo}
            </button>
          ))}
        </div>
      )}

      {/* Agent groups */}
      <div
        role="listbox"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Agent list"
        className="agent-list__scroll-container"
      >
        {fetchError && agents.length === 0 && (
          <div className="agent-list__empty-message">
            <span style={{ color: neonVar('red', 'color') }}>{fetchError}</span>
            {onRetry && (
              <button
                onClick={onRetry}
                className="agent-list__empty-retry"
                style={{
                  border: `1px solid ${neonVar('cyan', 'border')}`,
                  color: neonVar('cyan', 'color')
                }}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {fetchError && agents.length > 0 && (
          <div
            className="agent-list__error-banner"
            style={{
              background: neonVar('orange', 'surface'),
              borderBottom: `1px solid ${neonVar('orange', 'border')}`,
              color: neonVar('orange', 'color')
            }}
          >
            <span>Refresh failed — showing cached list</span>
            {onRetry && (
              <button
                onClick={onRetry}
                className="agent-list__retry-button"
                style={{
                  color: neonVar('orange', 'color')
                }}
              >
                Retry
              </button>
            )}
          </div>
        )}

        {loading && agents.length === 0 && !fetchError && (
          <div className="agent-list__loading-container">
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
              <div
                key={a.id}
                ref={a.id === selectedId ? selectedRef : null}
                role="option"
                aria-selected={a.id === selectedId}
                tabIndex={-1}
              >
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
              <div
                key={a.id}
                ref={a.id === selectedId ? selectedRef : null}
                role="option"
                aria-selected={a.id === selectedId}
                tabIndex={-1}
              >
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
                <div
                  key={a.id}
                  ref={a.id === selectedId ? selectedRef : null}
                  role="option"
                  aria-selected={a.id === selectedId}
                  tabIndex={-1}
                >
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

        {filtered.length === 0 && !loading && !fetchError && agents.length === 0 && (
          <EmptyState
            title="No agents yet"
            description="Spawn an agent to get started. Agents execute tasks, answer questions, and write code."
          />
        )}

        {filtered.length === 0 && agents.length > 0 && (
          <EmptyState message="No agents match your filter. Try adjusting the search or clearing filters." />
        )}

        {hasMore && onLoadMore && (
          <div
            style={{
              padding: 'var(--bde-space-2)',
              display: 'flex',
              justifyContent: 'center'
            }}
          >
            <button className="agent-list__load-more" onClick={onLoadMore}>
              Load More
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
