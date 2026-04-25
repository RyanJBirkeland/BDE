import { Send, StopCircle } from 'lucide-react'
import { useState, type JSX, type KeyboardEvent } from 'react'

interface Props {
  onSend: (content: string) => void
  onAbort?: (() => void) | undefined
  streaming?: boolean | undefined
  disabled?: boolean | undefined
  disabledReason?: string | undefined
}

export function ReviewChatInput({
  onSend,
  onAbort,
  streaming = false,
  disabled = false,
  disabledReason
}: Props): JSX.Element {
  const [value, setValue] = useState('')
  const tooltip = disabled ? disabledReason : undefined

  function handleSubmit(): void {
    const trimmed = value.trim()
    if (!trimmed || streaming || disabled) return
    onSend(trimmed)
    setValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="cr-chat-input">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask about the changes..."
        disabled={disabled}
        rows={1}
        className="cr-chat-input__textarea"
        aria-label="Message to AI Review Partner"
        title={tooltip}
      />
      {streaming ? (
        <button
          type="button"
          className="cr-chat-input__button cr-chat-input__button--abort"
          onClick={onAbort}
          aria-label="Stop streaming"
        >
          <StopCircle size={14} />
        </button>
      ) : (
        <button
          type="button"
          className="cr-chat-input__button"
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          aria-label="Send message"
          title={tooltip ?? (!value.trim() ? 'Type a message to send' : undefined)}
        >
          <Send size={14} />
        </button>
      )}
    </div>
  )
}
