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
    alignSelf: 'flex-start'
  },
  user: {
    alignSelf: 'flex-end'
  },
  error: {
    alignSelf: 'flex-start'
  }
}

function formatTime(ts: number): string {
  const date = new Date(ts)
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function ChatBubble({ variant, text, timestamp }: ChatBubbleProps): React.JSX.Element {
  const bubbleStyle: CSSProperties = {
    ...variantStyles[variant],
    maxWidth: '85%',
    padding: `${tokens.space[2]} ${tokens.space[3]}`,
    borderRadius: tokens.radius.md,
    fontFamily: tokens.font.ui,
    fontSize: tokens.size.md,
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
    textAlign: variant === 'user' ? 'right' : 'left'
  }

  const bubbleClassName = `chat-bubble chat-bubble--${variant}`

  return (
    <div style={bubbleStyle} className={bubbleClassName}>
      <p style={textStyle}>{text}</p>
      {timestamp != null && (
        <div style={timestampStyle} className="chat-bubble__timestamp">
          {formatTime(timestamp)}
        </div>
      )}
    </div>
  )
}
