import { useEffect, useState, useCallback, useRef } from 'react'
import { useSessionsStore, AgentSession, SubAgent } from '../../stores/sessions'
import { useUIStore } from '../../stores/ui'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'
import { SpawnModal } from './SpawnModal'

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

function SessionRow({
  session,
  isSelected,
  isFocused,
  dataIndex,
  onSelect
}: {
  session: AgentSession
  isSelected: boolean
  isFocused?: boolean
  dataIndex?: number
  onSelect: () => void
}): React.JSX.Element {
  const isRunning = Date.now() - session.updatedAt < FIVE_MINUTES
  const isBlocked = session.abortedLastRun && !isRunning
  const killSession = useSessionsStore((s) => s.killSession)
  const [killing, setKilling] = useState(false)

  const handleKill = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      if (killing) return
      setKilling(true)
      try {
        await killSession(session.key)
      } finally {
        setKilling(false)
      }
    },
    [killing, killSession, session.key]
  )

  return (
    <button
      className={`session-row ${isSelected ? 'session-row--selected' : ''} ${isFocused ? 'session-row--focused' : ''}`}
      data-session-index={dataIndex}
      style={{ '--stagger-index': Math.min(dataIndex ?? 0, 10) } as React.CSSProperties}
      onClick={onSelect}
    >
      <span
        className={`session-row__dot ${isRunning ? 'session-row__dot--running' : ''} ${isBlocked ? 'session-row__dot--blocked' : ''}`}
        title={isBlocked ? 'Session aborted — may need attention' : undefined}
      />
      <div className="session-row__info">
        <span className="session-row__label">{session.displayName || session.key}</span>
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
          onClick={handleKill}
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
  onSelect
}: {
  agent: SubAgent
  isSelected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const killSession = useSessionsStore((s) => s.killSession)
  const steerSubAgent = useSessionsStore((s) => s.steerSubAgent)
  const [killing, setKilling] = useState(false)
  const [steerOpen, setSteerOpen] = useState(false)
  const [steerText, setSteerText] = useState('')
  const [steering, setSteering] = useState(false)
  const steerRef = useRef<HTMLInputElement>(null)

  const handleKill = useCallback(
    async (e: React.MouseEvent): Promise<void> => {
      e.stopPropagation()
      if (killing) return
      setKilling(true)
      try {
        await killSession(agent.sessionKey)
      } finally {
        setKilling(false)
      }
    },
    [killing, killSession, agent.sessionKey]
  )

  const handleSteerClick = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation()
    setSteerOpen(true)
  }, [])

  const handleSteerSubmit = useCallback(async (): Promise<void> => {
    const msg = steerText.trim()
    if (!msg || steering) return
    setSteering(true)
    try {
      await steerSubAgent(agent.sessionKey, msg)
      setSteerText('')
      setSteerOpen(false)
    } finally {
      setSteering(false)
    }
  }, [steerText, steering, steerSubAgent, agent.sessionKey])

  const handleSteerKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSteerSubmit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setSteerOpen(false)
        setSteerText('')
      }
    },
    [handleSteerSubmit]
  )

  useEffect(() => {
    if (steerOpen && steerRef.current) {
      steerRef.current.focus()
    }
  }, [steerOpen])

  return (
    <div className="sub-agent-row-wrapper">
      <button
        className={`sub-agent-row ${isSelected ? 'sub-agent-row--selected' : ''}`}
        onClick={onSelect}
      >
        <span
          className={`session-row__dot ${agent._isActive ? 'session-row__dot--running' : ''}`}
        />
        <div className="session-row__info">
          <span className="session-row__label">{agent.label}</span>
          <span className="session-row__meta">
            <Badge variant="muted" size="sm">{modelBadgeLabel(agent.model)}</Badge>
            <span className="session-row__time">{timeAgo(agent.startedAt)}</span>
            {!agent._isActive && (
              <Badge variant={agent.status === 'failed' || agent.status === 'timeout' ? 'danger' : 'muted'} size="sm">
                {agent.status}
              </Badge>
            )}
          </span>
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
              onClick={handleKill}
              title="Stop sub-agent"
            >
              {killing ? '...' : '\u00d7'}
            </span>
          </>
        )}
      </button>
      {steerOpen && (
        <div className="sub-agent-row__steer-input">
          <input
            ref={steerRef}
            type="text"
            placeholder="Redirect this agent..."
            value={steerText}
            onChange={(e) => setSteerText(e.target.value)}
            onKeyDown={handleSteerKeyDown}
            disabled={steering}
          />
          <button
            className="sub-agent-row__steer-send"
            onClick={handleSteerSubmit}
            disabled={steering || !steerText.trim()}
          >
            {steering ? '...' : 'Send'}
          </button>
        </div>
      )}
    </div>
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
  const activeView = useUIStore((s) => s.activeView)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [spawnOpen, setSpawnOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Adaptive polling: 5s when active sub-agents, 10s otherwise
  useEffect(() => {
    let cancelled = false

    const poll = async (): Promise<void> => {
      await fetchSessions()
      if (cancelled) return
      const hasActive = useSessionsStore.getState().subAgents.some((s) => s._isActive)
      const delay = hasActive ? 5_000 : 10_000
      timeoutRef.current = setTimeout(poll, delay)
    }

    poll()

    return () => {
      cancelled = true
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [fetchSessions])

  const now = Date.now()
  const running = sessions.filter((s) => now - s.updatedAt < FIVE_MINUTES)
  const recent = sessions.filter((s) => {
    if (now - s.updatedAt < FIVE_MINUTES) return false
    return now - s.updatedAt < 48 * 60 * 60 * 1000
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
                dataIndex={idx}
                onSelect={() => selectSession(s.key)}
              />
            )
          })}
        </div>
      )}

      {subAgents.length > 0 && (
        <div className="session-list__group">
          <span className="session-list__group-label">
            Sub-agents{activeSubAgentCount > 0 ? ` (${activeSubAgentCount})` : ''}
          </span>
          {subAgentsError && (
            <div className="sub-agent-row__error">Could not fetch sub-agents</div>
          )}
          {subAgents.map((agent) => (
            <SubAgentRow
              key={agent.sessionKey}
              agent={agent}
              isSelected={selectedKey === agent.sessionKey}
              onSelect={() => selectSession(agent.sessionKey)}
            />
          ))}
        </div>
      )}

      {subAgents.length === 0 && subAgentsError && (
        <div className="session-list__group">
          <span className="session-list__group-label">Sub-agents</span>
          <div className="sub-agent-row__error">Could not fetch sub-agents</div>
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
