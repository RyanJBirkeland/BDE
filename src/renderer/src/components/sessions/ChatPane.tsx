/**
 * ChatPane — self-contained pane that displays one agent session.
 * Designed for use in split-view layouts (single, 2-pane, grid-4).
 * Reuses ChatThread for message display and MessageInput for sending.
 */
import { useState, useCallback } from 'react'
import { ChatThread } from './ChatThread'
import { MessageInput } from './MessageInput'
import { useSessionsStore } from '../../stores/sessions'

export interface ChatPaneProps {
  paneIndex: number
  sessionKey: string | null
  isFocused: boolean
  onFocus: () => void
  onSessionChange: (key: string | null) => void
}

export function ChatPane({ sessionKey, isFocused, onFocus, onSessionChange }: ChatPaneProps): React.JSX.Element {
  const sessions = useSessionsStore((s) => s.sessions)
  const subAgents = useSessionsStore((s) => s.subAgents)

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

  const selectedSession = sessions.find((s) => s.key === sessionKey)
  const selectedSubAgent = subAgents.find((a) => a.sessionKey === sessionKey) ?? null
  const sessionMode: 'chat' | 'steer' = selectedSubAgent ? 'steer' : 'chat'

  const className = `chat-pane${isFocused ? ' chat-pane--focused' : ''}`

  return (
    <div className={className} onClick={onFocus}>
      <div className="chat-pane__header">
        <select
          className="chat-pane__session-select"
          value={sessionKey ?? ''}
          onChange={(e) => onSessionChange(e.target.value || null)}
        >
          <option value="">Select a session…</option>
          {sessions.map((s) => (
            <option key={s.key} value={s.key}>
              {s.displayName || s.key}
            </option>
          ))}
          {subAgents.map((a) => (
            <option key={a.sessionKey} value={a.sessionKey}>
              {a.label}
            </option>
          ))}
        </select>
        {sessionKey && (
          <button
            className="chat-pane__close"
            onClick={(e) => {
              e.stopPropagation()
              onSessionChange(null)
            }}
            title="Clear pane"
          >
            ×
          </button>
        )}
      </div>

      {sessionKey && (selectedSession || selectedSubAgent) ? (
        <>
          <div className="chat-pane__body">
            <ChatThread
              sessionKey={sessionKey}
              updatedAt={selectedSession?.updatedAt ?? selectedSubAgent?.startedAt ?? 0}
              refreshTrigger={refreshTrigger}
              optimisticMessages={optimisticMessages}
            />
          </div>
          <MessageInput
            sessionKey={sessionKey}
            sessionMode={sessionMode}
            onSent={onSent}
            onBeforeSend={onBeforeSend}
            onSendError={onSendError}
          />
        </>
      ) : (
        <div className="chat-pane__empty">Select a session or spawn an agent</div>
      )}
    </div>
  )
}
