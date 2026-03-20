import { useEffect, useRef, useState, useCallback } from 'react'
import { useVisibilityAwareInterval } from '../../hooks/useVisibilityAwareInterval'
import { invokeTool } from '../../lib/rpc'
import { useUIStore } from '../../stores/ui'
import { toast } from '../../stores/toasts'
import { EmptyState } from '../ui/EmptyState'
import { Spinner } from '../ui/Spinner'
import { CHAT_HISTORY_LIMIT, CHAT_SCROLL_THRESHOLD, CHAT_COLLAPSE_THRESHOLD, POLL_CHAT_STREAMING_MS, POLL_CHAT_IDLE_MS } from '../../lib/constants'
import { normalizeContent } from '../../lib/message'
import { renderContent, renderUserContent } from '../../lib/chat-markdown'
import type { ChatMessage } from '../../lib/agent-messages'
import { formatTime } from '../../lib/format'

const POLL_STREAMING = POLL_CHAT_STREAMING_MS
const POLL_IDLE = POLL_CHAT_IDLE_MS

interface Props {
  sessionKey?: string
  updatedAt?: number
  refreshTrigger?: number
  optimisticMessages?: ChatMessage[]
  /** Pre-fetched messages — skips IPC polling when provided */
  messages?: ChatMessage[]
  /** Streaming indicator for external messages mode */
  isStreaming?: boolean
}

export function ChatThread({ sessionKey, refreshTrigger = 0, optimisticMessages = [], messages: externalMessages, isStreaming: isStreamingProp }: Props): React.JSX.Element {
  const isExternalMode = externalMessages !== undefined
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedMsgs, setExpandedMsgs] = useState<Set<number>>(new Set())
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const messagesRef = useRef<ChatMessage[]>([])
  const lastCountRef = useRef(0)
  const prevLastAssistantContentRef = useRef('')
  const hasPolledRef = useRef(false)

  const isNearBottom = useCallback((): boolean => {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollTop + el.clientHeight >= el.scrollHeight - CHAT_SCROLL_THRESHOLD
  }, [])

  const scrollToBottom = useCallback((): void => {
    const el = scrollRef.current
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      })
      setUserScrolledUp(false)
    }
  }, [])

  const poll = useCallback(async (): Promise<void> => {
    try {
      const result = (await invokeTool('sessions_history', {
        sessionKey,
        limit: CHAT_HISTORY_LIMIT
      })) as { messages: ChatMessage[] }

      const incoming = (result?.messages ?? [])
        .map((m) => ({ ...m, content: normalizeContent(m.content) }))
        .filter((m) => m.role === 'tool' || m.content.trim().length > 0)

      if (incoming.length > lastCountRef.current) {
        const newMessages = incoming.slice(lastCountRef.current)
        const isInitialLoad = lastCountRef.current === 0
        messagesRef.current = [...messagesRef.current, ...newMessages]
        lastCountRef.current = incoming.length
        setMessages([...messagesRef.current])
        if (isInitialLoad || isNearBottom()) scrollToBottom()
      } else if (incoming.length < lastCountRef.current) {
        // Session was reset or messages were cleared
        messagesRef.current = incoming
        lastCountRef.current = incoming.length
        setMessages([...incoming])
      } else if (incoming.length > 0) {
        // Same count — update if last message content changed (streaming)
        const lastIn = incoming[incoming.length - 1]
        const lastCur = messagesRef.current[messagesRef.current.length - 1]
        if (lastIn && lastCur && lastIn.content !== lastCur.content) {
          messagesRef.current = incoming
          setMessages([...incoming])
          if (isNearBottom()) scrollToBottom()
        }
      }

      // Detect streaming: last message is assistant and content is still growing
      const lastMsg = incoming[incoming.length - 1]
      if (lastMsg?.role === 'assistant') {
        const grew =
          hasPolledRef.current &&
          lastMsg.content.length > prevLastAssistantContentRef.current.length
        prevLastAssistantContentRef.current = lastMsg.content
        setStreaming(grew)
      } else {
        prevLastAssistantContentRef.current = ''
        setStreaming(false)
      }
      hasPolledRef.current = true

      setLoading(false)
    } catch {
      if (loading) {
        toast.error('Failed to load chat history')
        setLoading(false)
      }
    }
  }, [sessionKey, loading, isNearBottom, scrollToBottom])

  const pollInterval = streaming ? POLL_STREAMING : POLL_IDLE

  // Initial fetch + state reset (skipped in external mode)
  useEffect(() => {
    if (isExternalMode) return

    setMessages([])
    setLoading(true)
    setExpandedMsgs(new Set())
    setExpandedTools(new Set())
    setStreaming(false)
    messagesRef.current = []
    lastCountRef.current = 0
    setUserScrolledUp(false)
    prevLastAssistantContentRef.current = ''
    hasPolledRef.current = false

    poll()
  }, [sessionKey, isExternalMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Adaptive visibility-aware polling (skipped in external mode)
  useVisibilityAwareInterval(poll, isExternalMode ? null : pollInterval)

  // Refresh on send (skipped in external mode)
  useEffect(() => {
    if (isExternalMode || refreshTrigger <= 0) return
    poll()
  }, [refreshTrigger, isExternalMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // External mode: auto-scroll when messages change
  useEffect(() => {
    if (!isExternalMode) return
    if (isNearBottom()) scrollToBottom()
  }, [externalMessages]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const scrolledUp = el.scrollTop + el.clientHeight < el.scrollHeight - CHAT_SCROLL_THRESHOLD
    setUserScrolledUp((prev) => (prev !== scrolledUp ? scrolledUp : prev))
  }, [])

  // Keyboard scrolling: PageUp/Down, End
  const activeView = useUIStore((s) => s.activeView)
  useEffect(() => {
    if (activeView !== 'sessions') return
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const el = scrollRef.current
      if (!el) return

      if (e.key === 'PageDown') {
        e.preventDefault()
        el.scrollBy({ top: el.clientHeight * 0.8, behavior: 'smooth' })
      } else if (e.key === 'PageUp') {
        e.preventDefault()
        el.scrollBy({ top: -el.clientHeight * 0.8, behavior: 'smooth' })
      } else if (e.key === 'End' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
        setUserScrolledUp(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeView])

  const showScrollButton = userScrolledUp && messages.length > 0

  const toggleExpand = useCallback((idx: number) => {
    setExpandedMsgs((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const toggleTool = useCallback((idx: number) => {
    setExpandedTools((prev) => {
      const n = new Set(prev)
      n.has(idx) ? n.delete(idx) : n.add(idx)
      return n
    })
  }, [])

  const effectiveStreaming = isExternalMode ? (isStreamingProp ?? false) : streaming
  const visibleMessages = isExternalMode ? externalMessages : [...messages, ...optimisticMessages]
  const lastAssistantVisibleIdx = effectiveStreaming
    ? visibleMessages.reduce((acc, m, i) => (m.role === 'assistant' ? i : acc), -1)
    : -1

  if (loading && !isExternalMode && visibleMessages.length === 0) {
    return (
      <div className="chat-thread chat-thread--loading">
        <Spinner size="md" />
      </div>
    )
  }

  return (
    <div className="chat-thread">
      <div className="chat-thread__messages" ref={scrollRef} onScroll={handleScroll}>
        {visibleMessages.length === 0 && !loading && (
          <EmptyState title="No messages yet" description="Send a message to start the conversation" />
        )}

        {visibleMessages.map((msg, idx) => {
          const key = msg.timestamp ? `${msg.role}-${msg.timestamp}-${idx}` : `msg-${idx}`
          if (msg.role === 'system') {
            return (
              <div key={key} className="chat-msg chat-msg--system">
                <span className="chat-msg__text">{msg.content}</span>
              </div>
            )
          }

          if (msg.role === 'tool') {
            return (
              <div key={key} className="chat-msg chat-msg--tool">
                <button className="log-msg__tool-toggle" onClick={() => toggleTool(idx)}>
                  <span className="log-msg__tool-arrow">{expandedTools.has(idx) ? '\u25BE' : '\u25B8'}</span>
                  <span className="log-msg__tool-name">{msg.toolName || 'tool'}</span>
                  <span className="log-msg__tool-preview">{msg.content.slice(0, 80)}</span>
                </button>
                {expandedTools.has(idx) && (
                  <pre className="log-msg__tool-args">{msg.content}</pre>
                )}
              </div>
            )
          }

          if (msg.role === 'user') {
            const hasAttachments = msg.content.includes('![') || msg.content.includes('📄 ')
            return (
              <div key={key} className="chat-msg chat-msg--user">
                <div className="chat-msg__bubble chat-msg__bubble--user">
                  <span className="chat-msg__text">
                    {hasAttachments ? renderUserContent(msg.content) : msg.content}
                  </span>
                </div>
                {msg.timestamp && (
                  <span className="chat-msg__time chat-msg__time--right">{formatTime(msg.timestamp)}</span>
                )}
              </div>
            )
          }

          // assistant — render with markdown + collapsible long messages
          const hasTicketsJson = msg.content.includes('tickets-json')
          const isLong = !hasTicketsJson && msg.content.length > CHAT_COLLAPSE_THRESHOLD
          const isExpanded = expandedMsgs.has(idx)

          return (
            <div key={key} className="chat-msg chat-msg--assistant">
              <div
                className={`chat-msg__bubble chat-msg__bubble--assistant${isLong && !isExpanded ? ' chat-msg__bubble--collapsed' : ''}`}
                onClick={isLong ? () => toggleExpand(idx) : undefined}
              >
                <span className="chat-msg__text chat-msg__text--rich">
                  {renderContent(msg.content)}
                  {idx === lastAssistantVisibleIdx && (
                    <span className="streaming-indicator--inline">
                      <span className="streaming-indicator__dot" />
                      <span className="streaming-indicator__dot" />
                      <span className="streaming-indicator__dot" />
                    </span>
                  )}
                </span>
                {isLong && !isExpanded && (
                  <div className="chat-msg__expand-fade">
                    <span className="chat-msg__expand-label">Click to expand</span>
                  </div>
                )}
              </div>
              {msg.timestamp && (
                <span className="chat-msg__time">{formatTime(msg.timestamp)}</span>
              )}
            </div>
          )
        })}
      </div>

      {showScrollButton && (
        <button className="chat-thread__scroll-btn bde-btn bde-btn--primary bde-btn--sm" onClick={scrollToBottom}>
          New messages
        </button>
      )}
    </div>
  )
}
