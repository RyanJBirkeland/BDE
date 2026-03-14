import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useChatStore, LogLine } from '../../stores/chat'
import { useSessionsStore } from '../../stores/sessions'
import { useGatewayStore } from '../../stores/gateway'
import { useUIStore } from '../../stores/ui'
import { Button } from '../ui/Button'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toTimeString().slice(0, 8)
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\u2026' : s
}

function roleLabel(line: LogLine): string {
  if (line.toolName) return line.toolName
  return line.role
}

function lineClass(line: LogLine): string {
  switch (line.role) {
    case 'assistant':
      return 'feed-line--assistant'
    case 'user':
      return 'feed-line--user'
    case 'tool':
      return 'feed-line--tool'
    case 'system':
      return 'feed-line--system'
    default:
      return 'feed-line--text'
  }
}

export function LiveFeed(): React.JSX.Element {
  const selectedKey = useSessionsStore((s) => s.selectedSessionKey)
  const linesMap = useChatStore((s) => s.lines)
  const addLine = useChatStore((s) => s.addLine)
  const clearSession = useChatStore((s) => s.clearSession)
  const clearAll = useChatStore((s) => s.clearAll)
  const client = useGatewayStore((s) => s.client)
  const activeView = useUIStore((s) => s.activeView)

  const linesRef = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)

  const lines = useMemo(() => {
    if (selectedKey) return linesMap[selectedKey] ?? []
    return Object.values(linesMap).flat().sort((a, b) => a.timestamp - b.timestamp)
  }, [linesMap, selectedKey])

  // Always subscribe to all session_log messages
  useEffect(() => {
    if (!client) return
    const unsub = client.onMessage((data) => {
      const msg = data as {
        type?: string
        sessionKey?: string
        role?: string
        content?: string
        toolName?: string
      }
      if (msg.type === 'session_log' && msg.sessionKey) {
        addLine(msg.sessionKey, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: (msg.role as LogLine['role']) ?? 'assistant',
          content: msg.content ?? '',
          toolName: msg.toolName,
          timestamp: Date.now()
        })
      }
    })
    return unsub
  }, [client, addLine])

  // Auto-scroll unless paused
  useEffect(() => {
    if (!paused && linesRef.current) {
      linesRef.current.scrollTop = linesRef.current.scrollHeight
    }
  }, [lines, paused])

  const handleScroll = useCallback(() => {
    const el = linesRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setPaused(!atBottom)
  }, [])

  const handleClear = (): void => {
    if (selectedKey) {
      clearSession(selectedKey)
    } else {
      clearAll()
    }
  }

  const handleResume = (): void => {
    setPaused(false)
    if (linesRef.current) {
      linesRef.current.scrollTop = linesRef.current.scrollHeight
    }
  }

  // Keyboard: PageUp/PageDown to scroll, End to jump to bottom
  useEffect(() => {
    if (activeView !== 'sessions') return

    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const el = linesRef.current
      if (!el) return

      if (e.key === 'PageDown') {
        e.preventDefault()
        el.scrollTop += el.clientHeight * 0.8
      } else if (e.key === 'PageUp') {
        e.preventDefault()
        el.scrollTop -= el.clientHeight * 0.8
      } else if (e.key === 'End') {
        e.preventDefault()
        el.scrollTop = el.scrollHeight
        setPaused(false)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeView])

  return (
    <div className="live-feed">
      <div className="live-feed__header">
        <div className="live-feed__header-left">
          <span className="live-feed__title">Live Feed</span>
          {selectedKey && <span className="live-feed__session-key">{selectedKey}</span>}
        </div>
        <Button variant="ghost" size="sm" onClick={handleClear} title="Clear feed">
          Clear
        </Button>
      </div>
      <div className="live-feed__lines" ref={linesRef} onScroll={handleScroll}>
        {lines.map((line) => (
          <div key={line.id} className={`feed-line ${lineClass(line)}`}>
            <span className="feed-line__time">{formatTime(line.timestamp)}</span>
            <span className={`feed-line__role feed-line__role--${line.role}`}>
              {roleLabel(line)}
            </span>
            <span className="feed-line__content">{truncate(line.content, 120)}</span>
          </div>
        ))}
        {lines.length === 0 && (
          <span className="live-feed__waiting">
            {selectedKey ? 'Waiting for output\u2026' : 'Waiting for gateway messages\u2026'}
          </span>
        )}
      </div>
      {paused && (
        <Button variant="ghost" size="sm" className="live-feed__resume" onClick={handleResume}>
          Resume auto-scroll
        </Button>
      )}
    </div>
  )
}
