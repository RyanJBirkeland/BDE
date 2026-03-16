/**
 * SessionsView — two-pane chat interface for agent sessions.
 * Left pane: session list with status dots + model badge.
 * Right pane: chat thread for selected session (includes message input).
 */
import { useEffect, useState, useCallback } from 'react'
import { SessionList } from '../components/sessions/SessionList'
import { ChatThread } from '../components/sessions/ChatThread'
import { MessageInput } from '../components/sessions/MessageInput'
import { EmptyState } from '../components/ui/EmptyState'
import { useSessionsStore } from '../stores/sessions'

const POLL_INTERVAL = 10_000

export function SessionsView(): React.JSX.Element {
  const sessions = useSessionsStore((s) => s.sessions)
  const selectedKey = useSessionsStore((s) => s.selectedSessionKey)
  const selectSession = useSessionsStore((s) => s.selectSession)
  const fetchSessions = useSessionsStore((s) => s.fetchSessions)

  useEffect(() => {
    fetchSessions()
    const id = setInterval(fetchSessions, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [fetchSessions])

  useEffect(() => {
    if (sessions.length > 0 && !selectedKey) {
      selectSession(sessions[0].key)
    }
  }, [sessions, selectedKey, selectSession])

  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [optimisticMessages, setOptimisticMessages] = useState<{ role: 'user'; content: string }[]>([])

  const onBeforeSend = useCallback((message: string) => {
    setOptimisticMessages([{ role: 'user', content: message }])
  }, [])

  const onSent = useCallback(() => {
    setOptimisticMessages([])
    setRefreshTrigger((n) => n + 1)
  }, [])

  const onSendError = useCallback(() => {
    setOptimisticMessages([])
  }, [])

  const selectedSession = sessions.find((s) => s.key === selectedKey)

  return (
    <div className="sessions-chat">
      <div className="sessions-chat__sidebar" style={{ width: sidebarWidth }}>
        <SessionList />
      </div>
      <div
        className="sessions-view__handle"
        onMouseDown={(e) => {
          e.preventDefault()
          const startX = e.clientX
          const startW = sidebarWidth
          const onMove = (ev: MouseEvent): void => {
            const delta = ev.clientX - startX
            setSidebarWidth(Math.min(400, Math.max(180, startW + delta)))
          }
          const onUp = (): void => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        }}
      />
      <div className="sessions-chat__main">
        {selectedKey && selectedSession ? (
          <>
            <div className="sessions-chat__header">
              <span className="sessions-chat__session-name">
                {selectedSession.displayName || selectedSession.key}
              </span>
            </div>
            <div className="sessions-chat__thread">
              <ChatThread
                sessionKey={selectedKey}
                updatedAt={selectedSession.updatedAt}
                refreshTrigger={refreshTrigger}
                optimisticMessages={optimisticMessages}
              />
            </div>
            <div className="sessions-chat__input">
              <MessageInput sessionKey={selectedKey} onSent={onSent} onBeforeSend={onBeforeSend} onSendError={onSendError} />
            </div>
          </>
        ) : (
          <EmptyState
            title="Select a session"
            description="Choose a session from the list to start chatting"
          />
        )}
      </div>
    </div>
  )
}
