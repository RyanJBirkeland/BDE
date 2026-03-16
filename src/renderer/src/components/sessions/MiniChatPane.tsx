/**
 * MiniChatPane — compact card for the 2×2 grid-4 layout.
 * Shows last 3 lines of chat messages with a small header.
 */
import { useEffect, useRef, useState } from 'react'
import { invokeTool } from '../../lib/rpc'
import { useSessionsStore } from '../../stores/sessions'
import { POLL_PROCESSES_INTERVAL } from '../../lib/constants'
import { normalizeContent } from '../../lib/message'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
}

export interface MiniChatPaneProps {
  paneIndex: number
  sessionKey: string | null
  isFocused: boolean
  onFocus: () => void
  onSessionChange: (key: string | null) => void
}


export function MiniChatPane({ paneIndex, sessionKey, isFocused, onFocus, onSessionChange }: MiniChatPaneProps): React.JSX.Element {
  const sessions = useSessionsStore((s) => s.sessions)
  const subAgents = useSessionsStore((s) => s.subAgents)

  const [lastLines, setLastLines] = useState<string[]>([])
  const [hasNew, setHasNew] = useState(false)
  const prevCountRef = useRef(0)
  const newTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const session = sessions.find((s) => s.key === sessionKey)
  const channel = session?.channel || session?.lastChannel || ''

  useEffect(() => {
    if (!sessionKey) {
      setLastLines([])
      prevCountRef.current = 0
      return
    }

    let cancelled = false

    const poll = async (): Promise<void> => {
      try {
        const result = (await invokeTool('sessions_history', {
          sessionKey,
          limit: 20
        })) as { messages: ChatMessage[] }

        if (cancelled) return

        const messages = (result?.messages ?? [])
          .map((m) => ({ ...m, content: normalizeContent(m.content) }))
          .filter((m) => m.role !== 'tool' && m.role !== 'system' && m.content.trim().length > 0)

        // Extract last 3 content lines
        const lines: string[] = []
        for (let i = messages.length - 1; i >= 0 && lines.length < 3; i--) {
          const text = messages[i].content.trim()
          const contentLines = text.split('\n').filter((l) => l.trim())
          for (let j = contentLines.length - 1; j >= 0 && lines.length < 3; j--) {
            lines.unshift(contentLines[j].slice(0, 120))
          }
        }
        setLastLines(lines)

        // Detect new output → pulse border
        if (messages.length > prevCountRef.current && prevCountRef.current > 0) {
          setHasNew(true)
          if (newTimerRef.current) clearTimeout(newTimerRef.current)
          newTimerRef.current = setTimeout(() => setHasNew(false), 2000)
        }
        prevCountRef.current = messages.length
      } catch {
        // Silently ignore poll errors in mini pane
      }
    }

    poll()
    const id = setInterval(poll, POLL_PROCESSES_INTERVAL)

    return () => {
      cancelled = true
      clearInterval(id)
      if (newTimerRef.current) clearTimeout(newTimerRef.current)
    }
  }, [sessionKey])

  const classNames = [
    'mini-chat-pane',
    isFocused && 'mini-chat-pane--focused',
    hasNew && 'mini-chat-pane--pulse'
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classNames} onClick={onFocus}>
      <div className="mini-chat-pane__header">
        <select
          className="mini-chat-pane__select"
          value={sessionKey ?? ''}
          onChange={(e) => {
            e.stopPropagation()
            onSessionChange(e.target.value || null)
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <option value="">Pane {paneIndex + 1}…</option>
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
        {channel && <span className="mini-chat-pane__channel">[{channel}]</span>}
      </div>

      <div className="mini-chat-pane__lines">
        {sessionKey && lastLines.length > 0 ? (
          lastLines.map((line, i) => (
            <div key={`${i}-${line.slice(0, 20)}`} className="mini-chat-pane__line">
              {line}
            </div>
          ))
        ) : sessionKey ? (
          <div className="mini-chat-pane__line mini-chat-pane__line--empty">Waiting for output…</div>
        ) : (
          <div className="mini-chat-pane__line mini-chat-pane__line--empty">Click to select a session</div>
        )}
        {sessionKey && lastLines.length > 0 && <span className="mini-chat-pane__cursor">▋</span>}
      </div>
    </div>
  )
}
