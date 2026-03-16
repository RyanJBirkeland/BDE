import { useState, useCallback } from 'react'
import { toast } from '../../stores/toasts'
import { useGatewayStore } from '../../stores/gateway'
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
  const client = useGatewayStore((s) => s.client)

  const send = useCallback(async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || sending || !client) return

    setSending(true)
    setText('')
    onBeforeSend?.(trimmed)

    try {
      await client.call('chat.send', { sessionKey, message: trimmed, idempotencyKey: crypto.randomUUID() })
      onSent()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[MessageInput] chat.send failed:', msg, { sessionKey, client: !!client })
      toast.error(`Send failed: ${msg}`)
      onSendError?.()
    } finally {
      setSending(false)
    }
  }, [text, sending, client, sessionKey, onSent, onBeforeSend, onSendError])

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
