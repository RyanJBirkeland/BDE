import { useEffect, useState, useCallback, useRef } from 'react'
import { useSessionsStore, AgentSession, SubAgent } from '../../stores/sessions'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { useUIStore } from '../../stores/ui'
import { toast } from '../../stores/toasts'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'
import { SpawnModal } from './SpawnModal'
import { LocalAgentRow, cwdToRepoLabel } from './LocalAgentRow'

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const FIVE_MINUTES = 5 * 60 * 1000

function modelBadgeLabel(model: string): string {
  if (model.includes('opus')) return 'opus'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('haiku')) return 'haiku'
  return model.split('-')[0] ?? model
}

function shortKey(key: string): string {
  const parts = key.split(':')
  const last = parts[parts.length - 1] ?? key
  const isUUID = /^[0-9a-f-]{36}$/.test(last)
  if (isUUID) return parts[parts.length - 2] ?? last
  return last
}

function SessionRow({
  session,
  isSelected,
  isFocused,
  isIdle,
  dataIndex,
  onSelect
}: {
  session: AgentSession
  isSelected: boolean
  isFocused?: boolean
  isIdle?: boolean
  dataIndex?: number
  onSelect: () => void
}): React.JSX.Element {
  const isRunning = Date.now() - session.updatedAt < FIVE_MINUTES
  const isBlocked = session.abortedLastRun && !isRunning
  const killSession = useSessionsStore((s) => s.killSession)
  const [killing, setKilling] = useState(false)
  const killTargetRef = useRef(false)

  const handleKillDown = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation()
      killTargetRef.current = true
    },
    []
  )

  const handleKillUp = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      if (!killTargetRef.current || killing) return
      killTargetRef.current = false
      setKilling(true)
      try {
        await killSession(session.key)
      } finally {
        setKilling(false)
      }
    },
    [killing, killSession, session.key]
  )

  const handleKillLeave = useCallback((): void => {
    killTargetRef.current = false
  }, [])

  return (
    <button
      className={`session-row ${isSelected ? 'session-row--selected' : ''} ${isFocused ? 'session-row--focused' : ''} ${isIdle && !isSelected ? 'session-row--idle' : ''}`}
      data-session-index={dataIndex}
      style={{ '--stagger-index': Math.min(dataIndex ?? 0, 10) } as React.CSSProperties}
      onClick={onSelect}
    >
      <span
        className={`session-row__dot ${isRunning ? 'session-row__dot--running' : ''} ${isBlocked ? 'session-row__dot--blocked' : ''}`}
        title={isBlocked ? 'Session aborted — may need attention' : undefined}
      />
      <div className="session-row__info">
        <span className="session-row__label">{session.displayName || shortKey(session.key)}</span>
        <span className="session-row__meta">
          <Badge variant="muted" size="sm">{modelBadgeLabel(session.model)}</Badge>
          <span className="session-row__time">{timeAgo(session.updatedAt)}</span>
        </span>
      </div>
      {isRunning && (
        <span
          className="session-row__kill"
          role="button"
          tabIndex={-1}
          onMouseDown={handleKillDown}
          onMouseUp={handleKillUp}
          onMouseLeave={handleKillLeave}
          title="Stop session"
        >
          {killing ? '...' : '\u00d7'}
        </span>
      )}
    </button>
  )
}

function SubAgentRow({
  agent,
  isSelected,
  isCompleted,
  onSelect
}: {
  agent: SubAgent
  isSelected: boolean
  isCompleted: boolean
  onSelect: () => void
}): React.JSX.Element {
  const killSession = useSessionsStore((s) => s.killSession)
  const selectSession = useSessionsStore((s) => s.selectSession)
  const [killing, setKilling] = useState(false)
  const killTargetRef = useRef(false)

  const handleKillDown = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation()
      killTargetRef.current = true
    },
    []
  )

  const handleKillUp = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      if (!killTargetRef.current || killing) return
      killTargetRef.current = false
      setKilling(true)
      try {
        await killSession(agent.sessionKey)
      } finally {
        setKilling(false)
      }
    },
    [killing, killSession, agent.sessionKey]
  )

  const handleKillLeave = useCallback((): void => {
    killTargetRef.current = false
  }, [])

  const handleSteerClick = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation()
    selectSession(agent.sessionKey)
    window.dispatchEvent(new CustomEvent('bde:focus-message-input'))
  }, [agent.sessionKey, selectSession])

  const rowClass = [
    'sub-agent-row',
    isSelected ? 'sub-agent-row--selected' : '',
    isCompleted ? 'sub-agent-row--completed' : ''
  ].filter(Boolean).join(' ')

  return (
    <button className={rowClass} onClick={onSelect}>
      {agent._isActive ? (
        <span className="session-row__dot session-row__dot--running" />
      ) : (
        <span className="sub-agent-row__check" title="Completed">✓</span>
      )}
      <div className="session-row__info">
        <span
          className="session-row__label"
          style={!agent._isActive ? { opacity: 0.7 } : undefined}
        >
          {agent.label}
        </span>
        <span className="session-row__meta">
          <Badge variant="muted" size="sm">{modelBadgeLabel(agent.model)}</Badge>
          <span className="session-row__time">{timeAgo(agent.startedAt)}</span>
          {!agent._isActive && (
            <Badge variant={agent.status === 'failed' || agent.status === 'timeout' ? 'danger' : 'muted'} size="sm">
              {agent.status}
            </Badge>
          )}
        </span>
        {agent.task && (
          <span className="sub-agent-row__task">{agent.task}</span>
        )}
      </div>
      {agent._isActive && (
        <>
          <span
            className="sub-agent-row__action"
            role="button"
            tabIndex={-1}
            onClick={handleSteerClick}
            title="Steer sub-agent"
          >
            ✎
          </span>
          <span
            className="sub-agent-row__action sub-agent-row__action--kill"
            role="button"
            tabIndex={-1}
            onMouseDown={handleKillDown}
            onMouseUp={handleKillUp}
            onMouseLeave={handleKillLeave}
            title="Stop sub-agent"
          >
            {killing ? '...' : '\u00d7'}
          </span>
        </>
      )}
    </button>
  )
}

export function SessionList(): React.JSX.Element {
  const sessions = useSessionsStore((s) => s.sessions)
  const subAgents = useSessionsStore((s) => s.subAgents)
  const subAgentsError = useSessionsStore((s) => s.subAgentsError)
  const selectedKey = useSessionsStore((s) => s.selectedSessionKey)
  const selectSession = useSessionsStore((s) => s.selectSession)
  const fetchSessions = useSessionsStore((s) => s.fetchSessions)
  const loading = useSessionsStore((s) => s.loading)
  const fetchError = useSessionsStore((s) => s.fetchError)
  const followMode = useSessionsStore((s) => s.followMode)
  const setFollowMode = useSessionsStore((s) => s.setFollowMode)
  const localProcesses = useLocalAgentsStore((s) => s.processes)
  const localCollapsed = useLocalAgentsStore((s) => s.collapsed)
  const setLocalCollapsed = useLocalAgentsStore((s) => s.setCollapsed)
  const fetchProcesses = useLocalAgentsStore((s) => s.fetchProcesses)
  const activeView = useUIStore((s) => s.activeView)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [spawnOpen, setSpawnOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const prevActiveKeysRef = useRef<Set<string>>(new Set())
  const [completedKeys, setCompletedKeys] = useState<Set<string>>(new Set())

  // Adaptive polling: 5s when active sub-agents, 10s otherwise
  useEffect(() => {
    let cancelled = false

    const poll = async (): Promise<void> => {
      await fetchSessions()
      if (cancelled) return

      // Detect sub-agent completions (active → inactive transitions)
      const currentSubAgents = useSessionsStore.getState().subAgents
      const nowActive = new Set(
        currentSubAgents.filter((a) => a._isActive).map((a) => a.sessionKey)
      )
      for (const key of prevActiveKeysRef.current) {
        if (!nowActive.has(key)) {
          const agent = currentSubAgents.find((a) => a.sessionKey === key)
          if (agent) {
            toast.info(`${agent.label} finished`, {
              action: 'View',
              onAction: () => useSessionsStore.getState().selectSession(key)
            })
            // Mark as completed for fade-out animation
            setCompletedKeys((prev) => new Set(prev).add(key))
            // Remove from list after 30s fade-out
            setTimeout(() => {
              setCompletedKeys((prev) => {
                const next = new Set(prev)
                next.delete(key)
                return next
              })
            }, 30_500)
          }
        }
      }
      prevActiveKeysRef.current = nowActive

      const hasActive = nowActive.size > 0
      const delay = hasActive ? 5_000 : 10_000
      timeoutRef.current = setTimeout(poll, delay)
    }

    poll()

    return () => {
      cancelled = true
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [fetchSessions])

  // Poll local agent processes every 5s
  useEffect(() => {
    fetchProcesses()
    const interval = setInterval(fetchProcesses, 5_000)
    return () => clearInterval(interval)
  }, [fetchProcesses])

  // Filter helpers
  const filterSession = (s: AgentSession): boolean => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      (s.displayName ?? shortKey(s.key)).toLowerCase().includes(q) ||
      s.model.toLowerCase().includes(q) ||
      s.key.toLowerCase().includes(q)
    )
  }

  const filterSubAgent = (a: SubAgent): boolean => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      a.label.toLowerCase().includes(q) ||
      a.task.toLowerCase().includes(q) ||
      a.model.toLowerCase().includes(q)
    )
  }

  const now = Date.now()
  const running = sessions.filter((s) => now - s.updatedAt < FIVE_MINUTES && filterSession(s))
  const recent = sessions.filter((s) => {
    if (now - s.updatedAt < FIVE_MINUTES) return false
    if (now - s.updatedAt >= 48 * 60 * 60 * 1000) return false
    return filterSession(s)
  })
  const filteredSubAgents = subAgents.filter(filterSubAgent)

  const filteredLocalAgents = localProcesses.filter((p) => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      p.bin.toLowerCase().includes(q) ||
      cwdToRepoLabel(p.cwd).toLowerCase().includes(q) ||
      String(p.pid).includes(q)
    )
  })

  const activeSubAgentCount = subAgents.filter((s) => s._isActive).length

  // Flat ordered list for keyboard nav
  const orderedSessions = [...running, ...recent]

  useEffect(() => {
    if (activeView !== 'sessions') return

    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusIndex((prev) => {
          const max = orderedSessions.length - 1
          if (max < 0) return -1
          if (e.key === 'ArrowDown') return prev < max ? prev + 1 : 0
          return prev > 0 ? prev - 1 : max
        })
      }

      if (e.key === 'Enter' && focusIndex >= 0 && focusIndex < orderedSessions.length) {
        e.preventDefault()
        selectSession(orderedSessions[focusIndex].key)
      }

      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeView, focusIndex, orderedSessions, selectSession])

  // Scroll focused item into view
  useEffect(() => {
    if (focusIndex < 0) return
    const el = listRef.current?.querySelector(`[data-session-index="${focusIndex}"]`) as HTMLElement
    el?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])

  // Sync focusIndex when selectedKey changes externally
  useEffect(() => {
    if (selectedKey) {
      const idx = orderedSessions.findIndex((s) => s.key === selectedKey)
      if (idx >= 0) setFocusIndex(idx)
    }
  }, [selectedKey]) // eslint-disable-line react-hooks/exhaustive-deps

  let sessionIdx = 0

  return (
    <div className="session-list" ref={listRef}>
      <div className="session-list__header">
        <span className="session-list__title">Sessions</span>
        <div className="session-list__header-actions">
          <Button variant="primary" size="sm" onClick={() => setSpawnOpen(true)} title="Spawn new agent">
            + Spawn
          </Button>
          <Button variant="icon" size="sm" onClick={fetchSessions} title="Refresh">
            ↻
          </Button>
        </div>
      </div>

      <SpawnModal open={spawnOpen} onClose={() => setSpawnOpen(false)} />

      <div className="session-list__search">
        <input
          ref={searchRef}
          type="text"
          placeholder="Filter sessions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('')
              searchRef.current?.blur()
            }
          }}
        />
      </div>

      {fetchError && (
        <div className="session-list__error">{fetchError}</div>
      )}

      {loading && sessions.length === 0 && (
        <div className="session-list__loading">
          <div className="session-list__skeleton" />
          <div className="session-list__skeleton" />
          <div className="session-list__skeleton" />
        </div>
      )}

      {running.length > 0 && (
        <div className="session-list__group">
          <span className="session-list__group-label">Running</span>
          {running.map((s) => {
            const idx = sessionIdx++
            return (
              <SessionRow
                key={s.key}
                session={s}
                isSelected={selectedKey === s.key}
                isFocused={focusIndex === idx}
                dataIndex={idx}
                onSelect={() => selectSession(s.key)}
              />
            )
          })}
        </div>
      )}

      {recent.length > 0 && (
        <div className="session-list__group">
          <span className="session-list__group-label">Recent</span>
          {recent.map((s) => {
            const idx = sessionIdx++
            return (
              <SessionRow
                key={s.key}
                session={s}
                isSelected={selectedKey === s.key}
                isFocused={focusIndex === idx}
                isIdle
                dataIndex={idx}
                onSelect={() => selectSession(s.key)}
              />
            )
          })}
        </div>
      )}

      <div className="session-list__group">
        <div className="session-list__group-header">
          <span className="session-list__group-label">
            Sub-agents{activeSubAgentCount > 0 ? ` (${activeSubAgentCount})` : ''}
          </span>
          {subAgents.some((a) => a._isActive) && (
            <button
              className={`follow-toggle ${followMode ? 'follow-toggle--on' : ''}`}
              onClick={() => setFollowMode(!followMode)}
              title={followMode ? 'Follow mode ON — click to disable' : 'Follow mode OFF — click to enable'}
            >
              {'\ud83d\udccd'}
            </button>
          )}
        </div>
        {subAgentsError && (
          <div className="sub-agent-row__error">Could not fetch sub-agents</div>
        )}
        {filteredSubAgents.length > 0
          ? filteredSubAgents.map((agent) => (
              <div key={agent.sessionKey} className="sub-agent-row-wrapper">
                <SubAgentRow
                  agent={agent}
                  isSelected={selectedKey === agent.sessionKey}
                  isCompleted={completedKeys.has(agent.sessionKey)}
                  onSelect={() => selectSession(agent.sessionKey)}
                />
              </div>
            ))
          : !subAgentsError && (
              <span className="sub-agent-empty">No active sub-agents</span>
            )}
      </div>

      {filteredLocalAgents.length > 0 && (
        <div className="session-list__group">
          <div className="session-list__group-header">
            <button
              className="local-agents__collapse-btn"
              onClick={() => setLocalCollapsed(!localCollapsed)}
            >
              <span className={`local-agents__chevron ${localCollapsed ? '' : 'local-agents__chevron--open'}`}>
                ›
              </span>
              <span className="session-list__group-label" style={{ padding: 0 }}>
                Local Agents ({filteredLocalAgents.length})
              </span>
            </button>
            <span className="local-agents__live-dot" title="Polling every 5s" />
          </div>
          {!localCollapsed &&
            filteredLocalAgents.map((proc) => (
              <LocalAgentRow key={proc.pid} process={proc} />
            ))}
        </div>
      )}

      {!loading && !fetchError && sessions.length === 0 && (
        <EmptyState
          title="No active sessions"
          description="Agents will appear here when running"
        />
      )}
    </div>
  )
}
