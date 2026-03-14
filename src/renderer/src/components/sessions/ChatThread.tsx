import { useEffect, useRef, useState, useCallback } from 'react'
import { invokeTool } from '../../lib/rpc'
import { useUIStore } from '../../stores/ui'
import { toast } from '../../stores/toasts'
import { EmptyState } from '../ui/EmptyState'
import { Spinner } from '../ui/Spinner'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp?: number | string
  toolName?: string
  toolArgs?: Record<string, unknown>
}

function formatTime(ts: number | string | undefined): string {
  if (!ts) return ''
  const d = new Date(typeof ts === 'string' ? ts : ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Render markdown-ish content: code blocks, inline code, line breaks */
function renderContent(text: string): React.JSX.Element {
  const parts: React.JSX.Element[] = []
  let key = 0

  // Split on triple-backtick code blocks first
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRe.exec(text)) !== null) {
    // Text before this code block
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++}>{renderInline(text.slice(lastIndex, match.index))}</span>
      )
    }
    // The code block itself
    parts.push(
      <pre key={key++} className="chat-msg__code-block">
        <code>{match[2]}</code>
      </pre>
    )
    lastIndex = match.index + match[0].length
  }

  // Remaining text after last code block
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{renderInline(text.slice(lastIndex))}</span>)
  }

  return <>{parts}</>
}

/** Render inline code and line breaks */
function renderInline(text: string): React.JSX.Element {
  const parts: React.JSX.Element[] = []
  let key = 0
  const inlineRe = /`([^`]+)`/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++} className="chat-msg__text-plain">
          {text.slice(lastIndex, match.index)}
        </span>
      )
    }
    parts.push(
      <code key={key++} className="chat-msg__inline-code">
        {match[1]}
      </code>
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(
      <span key={key++} className="chat-msg__text-plain">
        {text.slice(lastIndex)}
      </span>
    )
  }

  return <>{parts}</>
}

const POLL_STREAMING = 1_000
const POLL_IDLE = 5_000

interface Props {
  sessionKey: string
  updatedAt?: number
  refreshTrigger: number
}

export function ChatThread({ sessionKey, refreshTrigger }: Props): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedMsgs, setExpandedMsgs] = useState<Set<number>>(new Set())
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)
  const messagesRef = useRef<ChatMessage[]>([])
  const lastCountRef = useRef(0)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevLastAssistantContentRef = useRef('')
  const hasPolledRef = useRef(false)
  const pollIntervalRef = useRef(POLL_IDLE)

  const isNearBottom = useCallback((): boolean => {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 80
  }, [])

  const scrollToBottom = useCallback((): void => {
    const el = scrollRef.current
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      })
      userScrolledUp.current = false
    }
  }, [])

  const poll = useCallback(async (): Promise<void> => {
    try {
      const result = (await invokeTool('sessions_history', {
        sessionKey,
        limit: 100
      })) as { messages: ChatMessage[] }

      // Normalize content — gateway may return content as array of blocks {type,text} or {type,thinking}
      const normalizeContent = (content: unknown): string => {
        if (typeof content === 'string') return content
        if (Array.isArray(content)) {
          return content.map((b: unknown) => {
            if (typeof b === 'string') return b
            if (b && typeof b === 'object') {
              const block = b as Record<string, unknown>
              if (block.type === 'thinking') return ''
              return typeof block.text === 'string' ? block.text : ''
            }
            return ''
          }).filter(Boolean).join('\n')
        }
        return String(content ?? '')
      }

      const incoming = (result?.messages ?? []).map((m) => ({ ...m, content: normalizeContent(m.content) }))

      if (incoming.length > lastCountRef.current) {
        const newMessages = incoming.slice(lastCountRef.current)
        messagesRef.current = [...messagesRef.current, ...newMessages]
        lastCountRef.current = incoming.length
        setMessages([...messagesRef.current])
        if (isNearBottom()) scrollToBottom()
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

  // Update polling interval ref on every render so the recursive timer picks it up
  pollIntervalRef.current = streaming ? POLL_STREAMING : POLL_IDLE

  // Stable ref so recursive setTimeout always calls latest poll
  const pollRef = useRef(poll)
  pollRef.current = poll

  // Initial fetch + adaptive poll
  useEffect(() => {
    setMessages([])
    setLoading(true)
    setExpandedMsgs(new Set())
    setStreaming(false)
    messagesRef.current = []
    lastCountRef.current = 0
    userScrolledUp.current = false
    prevLastAssistantContentRef.current = ''
    hasPolledRef.current = false

    pollRef.current()

    const schedulePoll = (): void => {
      pollTimerRef.current = setTimeout(async () => {
        await pollRef.current()
        schedulePoll()
      }, pollIntervalRef.current)
    }
    schedulePoll()

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [sessionKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh on send
  useEffect(() => {
    if (refreshTrigger > 0) {
      poll()
    }
  }, [refreshTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const threshold = 80
    userScrolledUp.current = el.scrollTop + el.clientHeight < el.scrollHeight - threshold
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
        userScrolledUp.current = false
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeView])

  const showScrollButton = userScrolledUp.current && messages.length > 0

  const toggleExpand = useCallback((idx: number) => {
    setExpandedMsgs((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  // Filter out tool messages for chat display
  const visibleMessages = messages.filter((m) => m.role !== 'tool')
  const lastAssistantVisibleIdx = streaming
    ? visibleMessages.reduce((acc, m, i) => (m.role === 'assistant' ? i : acc), -1)
    : -1

  if (loading && visibleMessages.length === 0) {
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
          if (msg.role === 'system') {
            return (
              <div key={idx} className="chat-msg chat-msg--system">
                <span className="chat-msg__text">{msg.content}</span>
              </div>
            )
          }

          if (msg.role === 'user') {
            return (
              <div key={idx} className="chat-msg chat-msg--user">
                <div className="chat-msg__bubble chat-msg__bubble--user">
                  <span className="chat-msg__text">{msg.content}</span>
                </div>
                {msg.timestamp && (
                  <span className="chat-msg__time chat-msg__time--right">{formatTime(msg.timestamp)}</span>
                )}
              </div>
            )
          }

          // assistant — render with markdown + collapsible long messages
          const isLong = msg.content.length > 600
          const isExpanded = expandedMsgs.has(idx)

          return (
            <div key={idx} className="chat-msg chat-msg--assistant">
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
