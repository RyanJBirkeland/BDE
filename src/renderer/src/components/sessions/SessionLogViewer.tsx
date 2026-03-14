import { useEffect, useRef, useState, useCallback } from 'react'
import { useSessionsStore } from '../../stores/sessions'
import { invokeTool } from '../../lib/rpc'
import { toast } from '../../stores/toasts'

interface HistoryMessage {
  role: 'assistant' | 'user' | 'tool' | 'system'
  content: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  timestamp?: number | string
}

function formatTimestamp(ts: number | string | undefined): string {
  if (!ts) return ''
  const d = new Date(typeof ts === 'string' ? ts : ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\u2026' : s
}

function messagesToMarkdown(messages: HistoryMessage[]): string {
  return messages
    .map((m) => {
      const role = m.toolName ? `tool:${m.toolName}` : m.role
      const time = formatTimestamp(m.timestamp)
      const prefix = time ? `[${time}] ` : ''
      return `${prefix}**${role}**: ${m.content}`
    })
    .join('\n\n')
}

const PAGE_SIZE = 50

export function SessionLogViewer(): React.JSX.Element {
  const selectedKey = useSessionsStore((s) => s.selectedSessionKey)
  const [messages, setMessages] = useState<HistoryMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchHistory = useCallback(
    async (offset = 0, prepend = false): Promise<void> => {
      if (!selectedKey) return
      setLoading(true)
      try {
        const result = (await invokeTool('sessions_history', {
          sessionKey: selectedKey,
          limit: PAGE_SIZE,
          offset
        })) as HistoryMessage[] | { messages?: HistoryMessage[] }

        const incoming = Array.isArray(result) ? result : (result?.messages ?? [])
        setHasMore(incoming.length >= PAGE_SIZE)

        if (prepend) {
          setMessages((prev) => [...incoming, ...prev])
        } else {
          setMessages(incoming)
        }
      } catch {
        toast.error('Failed to load session history')
        setMessages([])
        setHasMore(false)
      } finally {
        setLoading(false)
      }
    },
    [selectedKey]
  )

  useEffect(() => {
    setMessages([])
    setExpandedTools(new Set())
    setHasMore(false)
    if (selectedKey) {
      fetchHistory(0)
    }
  }, [selectedKey, fetchHistory])

  useEffect(() => {
    if (scrollRef.current && !loading) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const handleLoadMore = (): void => {
    fetchHistory(messages.length, true)
  }

  const toggleTool = (idx: number): void => {
    setExpandedTools((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  const handleCopy = async (): Promise<void> => {
    const md = messagesToMarkdown(messages)
    try {
      await navigator.clipboard.writeText(md)
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Failed to copy')
    }
  }

  if (!selectedKey) {
    return (
      <div className="log-viewer log-viewer--empty">
        <span className="log-viewer__placeholder">Select a session to view logs</span>
      </div>
    )
  }

  return (
    <div className="log-viewer">
      <div className="log-viewer__header">
        <span className="log-viewer__title">Session Log</span>
        <button className="log-viewer__btn" onClick={handleCopy} title="Copy as markdown">
          Copy
        </button>
      </div>
      <div className="log-viewer__messages" ref={scrollRef}>
        {hasMore && (
          <button
            className="log-viewer__load-more"
            onClick={handleLoadMore}
            disabled={loading}
          >
            {loading ? 'Loading\u2026' : 'Load earlier messages'}
          </button>
        )}
        {loading && messages.length === 0 && (
          <div className="log-viewer__loading">Loading history\u2026</div>
        )}
        {messages.map((msg, idx) => {
          const isToolCall = msg.role === 'tool' && msg.toolName && msg.toolArgs
          const isToolResult = msg.role === 'tool' && !msg.toolArgs
          const isExpanded = expandedTools.has(idx)

          if (msg.role === 'system') {
            return (
              <div key={idx} className="log-msg log-msg--system" title={formatTimestamp(msg.timestamp)}>
                <span className="log-msg__content">{msg.content}</span>
              </div>
            )
          }

          if (isToolCall) {
            return (
              <div key={idx} className="log-msg log-msg--tool" title={formatTimestamp(msg.timestamp)}>
                <button className="log-msg__tool-toggle" onClick={() => toggleTool(idx)}>
                  <span className="log-msg__tool-arrow">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                  <span className="log-msg__tool-name">{msg.toolName}</span>
                </button>
                {isExpanded && (
                  <pre className="log-msg__tool-args">
                    {JSON.stringify(msg.toolArgs, null, 2)}
                  </pre>
                )}
              </div>
            )
          }

          if (isToolResult) {
            return (
              <div key={idx} className="log-msg log-msg--tool-result" title={formatTimestamp(msg.timestamp)}>
                <button className="log-msg__tool-toggle" onClick={() => toggleTool(idx)}>
                  <span className="log-msg__tool-arrow">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                  <span className="log-msg__tool-label">
                    {msg.toolName ? `${msg.toolName} result` : 'tool result'}
                  </span>
                  {!isExpanded && (
                    <span className="log-msg__tool-preview">
                      {truncate(msg.content, 80)}
                    </span>
                  )}
                </button>
                {isExpanded && (
                  <pre className="log-msg__tool-args">{msg.content}</pre>
                )}
              </div>
            )
          }

          if (msg.role === 'user') {
            return (
              <div key={idx} className="log-msg log-msg--user" title={formatTimestamp(msg.timestamp)}>
                <span className="log-msg__content">{msg.content}</span>
              </div>
            )
          }

          return (
            <div key={idx} className="log-msg log-msg--assistant" title={formatTimestamp(msg.timestamp)}>
              <span className="log-msg__content">{msg.content}</span>
            </div>
          )
        })}
        {!loading && messages.length === 0 && (
          <span className="log-viewer__empty-msg">No messages in this session</span>
        )}
      </div>
    </div>
  )
}
