import { Sparkles } from 'lucide-react'
import type { JSX } from 'react'
import type { PartnerMessage } from '../../../../shared/types'

interface Props {
  messages: PartnerMessage[]
  emptyMessage?: string | undefined
}

export function ReviewMessageList({
  messages,
  emptyMessage = 'Select a task to see the AI review.'
}: Props): JSX.Element {
  if (messages.length === 0) {
    return <div className="cr-messages cr-messages--empty">{emptyMessage}</div>
  }

  return (
    <div className="cr-messages" role="log" aria-atomic="false">
      {messages.map((m) => (
        <div
          key={m.id}
          className={`cr-message cr-message--${m.role}${m.streaming ? ' cr-message--streaming' : ''}`}
          aria-busy={m.streaming ? 'true' : 'false'}
          aria-live={m.streaming ? 'polite' : undefined}
        >
          {m.role === 'assistant' && (
            <div className="cr-message__header">
              <Sparkles size={12} />
              <span>AI Partner</span>
            </div>
          )}
          <div className="cr-message__content">{m.content}</div>
          <div className="cr-message__timestamp">{new Date(m.timestamp).toLocaleTimeString()}</div>
        </div>
      ))}
    </div>
  )
}
