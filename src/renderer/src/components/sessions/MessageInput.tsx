import { useState, useCallback } from 'react'
import { invokeTool } from '../../lib/rpc'
import { toast } from '../../stores/toasts'
import { Textarea } from '../ui/Textarea'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

interface Props {
  sessionKey: string
  onSent: () => void
  onBeforeSend?: (message: string) => void
  onSendError?: () => void
  disabled?: boolean
}

export function MessageInput({ sessionKey, onSent, onBeforeSend, onSendError, disabled = false }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const send = useCallback(async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setSending(true)
    setText('')
    onBeforeSend?.(trimmed)

    try {
      await invokeTool('sessions_send', {
        sessionKey,
        message: trimmed
      })
      onSent()
    } catch {
      toast.error('Failed to send message')
      onSendError?.()
    } finally {
      setSending(false)
    }
  }, [text, sending, sessionKey, onSent, onBeforeSend, onSendError])

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
    <div className="message-input">
      <Textarea
        value={text}
        onChange={setText}
        onKeyDown={handleKeyDown}
        placeholder="Message..."
        disabled={disabled || sending}
        className="message-input__textarea"
      />
      <Button
        variant="primary"
        size="sm"
        className="message-input__send"
        onClick={send}
        disabled={!text.trim() || sending || disabled}
      >
        {sending ? <Spinner size="sm" /> : 'Send'}
      </Button>
    </div>
  )
}
