import { useEffect, useState, useCallback, useRef } from 'react'
import { useSessionsStore, AgentSession } from '../../stores/sessions'
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
      <span className={`session-row__dot ${isRunning ? 'session-row__dot--running' : ''}`} />
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

export function SessionList(): React.JSX.Element {
  const sessions = useSessionsStore((s) => s.sessions)
  const selectedKey = useSessionsStore((s) => s.selectedSessionKey)
  const selectSession = useSessionsStore((s) => s.selectSession)
  const fetchSessions = useSessionsStore((s) => s.fetchSessions)
  const loading = useSessionsStore((s) => s.loading)
  const fetchError = useSessionsStore((s) => s.fetchError)
  const activeView = useUIStore((s) => s.activeView)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [spawnOpen, setSpawnOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchSessions()
    const interval = setInterval(fetchSessions, 10_000)
    return () => clearInterval(interval)
  }, [fetchSessions])

  const now = Date.now()
  const running = sessions.filter((s) => now - s.updatedAt < FIVE_MINUTES)
  const recent = sessions.filter((s) => {
    if (now - s.updatedAt < FIVE_MINUTES) return false
    return now - s.updatedAt < 48 * 60 * 60 * 1000
  })

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

      {!loading && !fetchError && sessions.length === 0 && (
        <EmptyState
          title="No active sessions"
          description="Agents will appear here when running"
        />
      )}
    </div>
  )
}
