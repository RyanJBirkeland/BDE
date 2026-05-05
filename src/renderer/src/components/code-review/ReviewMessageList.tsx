import type { JSX } from 'react'
import type { PartnerMessage } from '../../../../shared/types'

interface Props {
  messages: PartnerMessage[]
  streaming?: boolean | undefined
  emptyMessage?: string | undefined
}

/**
 * Renders the AI partner conversation thread.
 * The Pulse Rule: exactly one `.fleet-pulse` appears in this view — the
 * streaming indicator while a partner message is in-progress. Nowhere else.
 */
export function ReviewMessageList({
  messages,
  streaming = false,
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
              {/* Pulse Rule: only the in-progress streaming indicator pulses */}
              {m.streaming && streaming && (
                <span className="fleet-pulse" aria-hidden="true" style={{ width: 6, height: 6 }} />
              )}
              <span className="cr-message__header-text">AI Partner</span>
            </div>
          )}
          <div className="cr-message__content">{m.content}</div>
          <div className="cr-message__timestamp">{new Date(m.timestamp).toLocaleTimeString()}</div>
        </div>
      ))}
    </div>
  )
}
