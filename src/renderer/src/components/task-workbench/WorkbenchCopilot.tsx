import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTaskWorkbenchStore, type CopilotMessage } from '../../stores/taskWorkbench'
import { tokens } from '../../design-system/tokens'

interface WorkbenchCopilotProps {
  onClose: () => void
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function MessageBubble({ msg, onInsert }: { msg: CopilotMessage; onInsert?: () => void }) {
  const isUser = msg.role === 'user'
  const isSystem = msg.role === 'system'

  const style: CSSProperties = {
    alignSelf: isUser ? 'flex-end' : 'flex-start',
    maxWidth: '90%',
    padding: `${tokens.space[2]} ${tokens.space[3]}`,
    borderRadius: tokens.radius.md,
    fontSize: tokens.size.md,
    color: tokens.color.text,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    ...(isUser
      ? { background: tokens.color.accentDim, border: '1px solid transparent' }
      : isSystem
        ? {
            background: 'transparent',
            border: `1px solid ${tokens.color.border}`,
            fontStyle: 'italic',
            color: tokens.color.textMuted,
            fontSize: tokens.size.sm
          }
        : { background: tokens.color.surface, border: `1px solid ${tokens.color.border}` })
  }

  return (
    <div style={style}>
      <div>{msg.content}</div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: tokens.space[1]
        }}
      >
        <span style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted }}>
          {formatTime(msg.timestamp)}
        </span>
        {msg.insertable && onInsert && (
          <button
            onClick={onInsert}
            style={{
              background: tokens.color.accentDim,
              border: `1px solid ${tokens.color.accent}`,
              borderRadius: tokens.radius.sm,
              color: tokens.color.accent,
              padding: '1px 8px',
              fontSize: tokens.size.xs,
              cursor: 'pointer'
            }}
          >
            Insert into spec
          </button>
        )}
      </div>
    </div>
  )
}

export function WorkbenchCopilot({ onClose }: WorkbenchCopilotProps) {
  const messages = useTaskWorkbenchStore((s) => s.copilotMessages)
  const loading = useTaskWorkbenchStore((s) => s.copilotLoading)
  const addMessage = useTaskWorkbenchStore((s) => s.addCopilotMessage)
  const title = useTaskWorkbenchStore((s) => s.title)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const spec = useTaskWorkbenchStore((s) => s.spec)
  const setField = useTaskWorkbenchStore((s) => s.setField)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const activeStreamIdRef = useRef<string | null>(null)

  // Subscribe to streaming chunks
  useEffect(() => {
    const store = useTaskWorkbenchStore.getState
    const unsub = window.api.workbench.onChatChunk((data) => {
      if (data.streamId !== activeStreamIdRef.current) return

      if (!data.done) {
        store().appendToStreamingMessage(data.chunk)
      } else {
        if (data.error) {
          // Replace streaming message content with error
          const msgId = store().streamingMessageId
          if (msgId) {
            useTaskWorkbenchStore.setState((s) => ({
              copilotMessages: s.copilotMessages.map((m) =>
                m.id === msgId ? { ...m, content: `Error: ${data.error}` } : m
              )
            }))
          }
          store().finishStreaming(false)
        } else {
          store().finishStreaming(true)
        }
        activeStreamIdRef.current = null
      }
    })
    return unsub
  }, [])

  // Auto-scroll on new messages and streaming content
  const streamingId = useTaskWorkbenchStore((s) => s.streamingMessageId)
  const streamingContent = messages.find((m) => m.id === streamingId)?.content?.length ?? 0

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, loading, streamingContent])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')

    addMessage({ id: `user-${Date.now()}`, role: 'user', content: text, timestamp: Date.now() })

    const allMessages = [...useTaskWorkbenchStore.getState().copilotMessages]
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }))
    allMessages.push({ role: 'user', content: text })

    // Create empty assistant message for streaming
    const msgId = `assistant-${Date.now()}`
    addMessage({ id: msgId, role: 'assistant', content: '', timestamp: Date.now() })

    try {
      const { streamId } = await window.api.workbench.chatStream({
        messages: allMessages,
        formContext: { title, repo, spec }
      })
      activeStreamIdRef.current = streamId
      useTaskWorkbenchStore.getState().startStreaming(msgId, streamId)
    } catch {
      // If we can't even start the stream, show error
      useTaskWorkbenchStore.setState((s) => ({
        copilotMessages: s.copilotMessages.map((m) =>
          m.id === msgId
            ? { ...m, content: 'Failed to reach Claude. Check your connection and try again.' }
            : m
        ),
        copilotLoading: false
      }))
    }
  }, [input, loading, title, repo, spec, addMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleInsert = useCallback(
    (msg: CopilotMessage) => {
      const current = useTaskWorkbenchStore.getState().spec
      const separator = current.trim() ? '\n\n' : ''
      setField('spec', current + separator + msg.content)
    },
    [setField]
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderLeft: `1px solid ${tokens.color.border}`
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${tokens.space[2]} ${tokens.space[3]}`,
          borderBottom: `1px solid ${tokens.color.border}`,
          flexShrink: 0
        }}
      >
        <span
          style={{
            fontSize: tokens.size.sm,
            fontWeight: 600,
            color: tokens.color.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.06em'
          }}
        >
          AI Copilot
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: tokens.color.textMuted,
            cursor: 'pointer',
            fontSize: tokens.size.lg,
            lineHeight: 1,
            padding: 0
          }}
          title="Close copilot"
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: tokens.space[3],
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[2]
        }}
      >
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onInsert={msg.insertable ? () => handleInsert(msg) : undefined}
          />
        ))}
        {loading && (
          <div
            style={{
              alignSelf: 'flex-start',
              padding: `${tokens.space[2]} ${tokens.space[3]}`,
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[2]
            }}
          >
            <span
              style={{
                color: tokens.color.textMuted,
                fontSize: tokens.size.sm,
                fontStyle: 'italic'
              }}
            >
              {useTaskWorkbenchStore.getState().streamingMessageId ? 'Streaming...' : 'Thinking...'}
            </span>
            <button
              onClick={() => {
                const sid = useTaskWorkbenchStore.getState().activeStreamId
                if (sid) {
                  window.api.workbench.cancelStream(sid)
                  useTaskWorkbenchStore.getState().finishStreaming(true)
                }
              }}
              style={{
                background: 'none',
                border: `1px solid ${tokens.color.border}`,
                borderRadius: tokens.radius.sm,
                color: tokens.color.textMuted,
                padding: '1px 8px',
                fontSize: tokens.size.xs,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Input */}
      <div
        style={{
          padding: tokens.space[2],
          borderTop: `1px solid ${tokens.color.border}`,
          display: 'flex',
          gap: tokens.space[2],
          flexShrink: 0
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the codebase, brainstorm approaches..."
          rows={2}
          style={{
            flex: 1,
            resize: 'none',
            padding: tokens.space[2],
            background: tokens.color.surface,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.md,
            color: tokens.color.text,
            fontSize: tokens.size.md,
            fontFamily: tokens.font.ui,
            outline: 'none'
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || loading}
          style={{
            alignSelf: 'flex-end',
            padding: `${tokens.space[2]} ${tokens.space[3]}`,
            background: !input.trim() || loading ? tokens.color.surface : tokens.color.accent,
            color:
              !input.trim() || loading ? tokens.color.textMuted : 'var(--bde-btn-primary-text)',
            border: 'none',
            borderRadius: tokens.radius.md,
            cursor: !input.trim() || loading ? 'not-allowed' : 'pointer',
            fontSize: tokens.size.sm,
            fontWeight: 600
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
