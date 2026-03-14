import { useEffect, useState, useCallback } from 'react'
import { useSessionsStore, AgentSession } from '../../stores/sessions'

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function modelBadgeLabel(model: string): string {
  if (model.includes('opus')) return 'opus'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('haiku')) return 'haiku'
  return model.split('-')[0] ?? model
}

function SessionRow({
  session,
  isSelected,
  onSelect
}: {
  session: AgentSession
  isSelected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const isRunning = session.status === 'running'
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
      className={`session-row ${isSelected ? 'session-row--selected' : ''}`}
      onClick={onSelect}
    >
      <span className={`session-row__dot ${isRunning ? 'session-row__dot--running' : ''}`} />
      <div className="session-row__info">
        <span className="session-row__label">{session.label || session.key}</span>
        <span className="session-row__meta">
          <span className="session-row__badge">{modelBadgeLabel(session.model)}</span>
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

  useEffect(() => {
    fetchSessions()
    const interval = setInterval(fetchSessions, 10_000)
    return () => clearInterval(interval)
  }, [fetchSessions])

  const running = sessions.filter((s) => s.status === 'running')
  const recent = sessions.filter((s) => {
    if (s.status === 'running') return false
    const age = Date.now() - new Date(s.updatedAt).getTime()
    return age < 48 * 60 * 60 * 1000
  })

  return (
    <div className="session-list">
      <div className="session-list__header">
        <span className="session-list__title">Sessions</span>
        <button className="session-list__refresh" onClick={fetchSessions} title="Refresh">
          ↻
        </button>
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
          {running.map((s) => (
            <SessionRow
              key={s.key}
              session={s}
              isSelected={selectedKey === s.key}
              onSelect={() => selectSession(s.key)}
            />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="session-list__group">
          <span className="session-list__group-label">Recent</span>
          {recent.map((s) => (
            <SessionRow
              key={s.key}
              session={s}
              isSelected={selectedKey === s.key}
              onSelect={() => selectSession(s.key)}
            />
          ))}
        </div>
      )}

      {!loading && !fetchError && sessions.length === 0 && (
        <div className="session-list__empty">No sessions</div>
      )}
    </div>
  )
}
