import { useState, useCallback, useRef, useEffect } from 'react'
import { SendHorizontal } from 'lucide-react'
import { tokens } from '../../design-system/tokens'

interface SteerInputProps {
  agentId: string
  onSend: (message: string) => void
}

export function SteerInput({ agentId, onSend }: SteerInputProps): React.JSX.Element {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isEmpty = text.trim().length === 0

  // Auto-resize textarea between 1 and 3 rows
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const lineHeight = 20
    const maxHeight = lineHeight * 3 + 12 // 3 rows + vertical padding
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`
  }, [text])

  const send = useCallback((): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }, [text, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        send()
      }
    },
    [send]
  )

  return (
    <div
      data-agent-id={agentId}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: tokens.space[2]
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Steer this agent..."
        rows={1}
        style={{
          flex: 1,
          resize: 'none',
          background: tokens.color.surface,
          color: tokens.color.text,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.sm,
          padding: `${tokens.space[2]} ${tokens.space[3]}`,
          fontFamily: tokens.font.ui,
          fontSize: tokens.size.md,
          lineHeight: '20px',
          outline: 'none',
          transition: `border-color ${tokens.transition.fast}`
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = tokens.color.accent
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = tokens.color.border
        }}
      />
      <button
        onClick={send}
        disabled={isEmpty}
        aria-label="Send message"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          flexShrink: 0,
          border: 'none',
          borderRadius: tokens.radius.sm,
          background: isEmpty ? tokens.color.accentDim : tokens.color.accent,
          color: isEmpty ? tokens.color.textDim : tokens.color.bg,
          cursor: isEmpty ? 'not-allowed' : 'pointer',
          transition: `background ${tokens.transition.fast}, color ${tokens.transition.fast}`
        }}
      >
        <SendHorizontal size={16} />
      </button>
    </div>
  )
}
