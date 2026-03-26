import type { CSSProperties } from 'react'

import { tokens } from '../../design-system/tokens'

type ChatBubbleVariant = 'agent' | 'user' | 'error'

interface ChatBubbleProps {
  variant: ChatBubbleVariant
  text: string
  timestamp?: number
}

const variantStyles: Record<ChatBubbleVariant, CSSProperties> = {
  agent: {
    alignSelf: 'flex-start',
    background: tokens.color.surface,
    border: `1px solid ${tokens.color.border}`
  },
  user: {
    alignSelf: 'flex-end',
    background: tokens.color.accentDim,
    border: `1px solid transparent`
  },
  error: {
    alignSelf: 'flex-start',
    background: tokens.color.dangerDim,
    border: `1px solid ${tokens.color.danger}`
  }
}

function formatTime(ts: number): string {
  const date = new Date(ts)
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function ChatBubble({ variant, text, timestamp }: ChatBubbleProps) {
  const bubbleStyle: CSSProperties = {
    ...variantStyles[variant],
    maxWidth: '85%',
    padding: `${tokens.space[2]} ${tokens.space[3]}`,
    borderRadius: tokens.radius.md,
    fontFamily: tokens.font.ui,
    fontSize: tokens.size.md,
    color: tokens.color.text,
    lineHeight: 1.5
  }

  const textStyle: CSSProperties = {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  }

  const timestampStyle: CSSProperties = {
    marginTop: tokens.space[1],
    fontSize: tokens.size.xs,
    color: tokens.color.textMuted,
    textAlign: variant === 'user' ? 'right' : 'left'
  }

  return (
    <div style={bubbleStyle}>
      <p style={textStyle}>{text}</p>
      {timestamp != null && <div style={timestampStyle}>{formatTime(timestamp)}</div>}
    </div>
  )
}
