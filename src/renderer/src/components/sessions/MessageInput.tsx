import { useState, useCallback, useEffect, useRef } from 'react'
import { toast } from '../../stores/toasts'
import { useGatewayStore } from '../../stores/gateway'
import { useSessionsStore } from '../../stores/sessions'
import { Textarea } from '../ui/Textarea'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

interface Props {
  sessionKey: string
  sessionMode: 'chat' | 'steer'
  onSent: () => void
  onBeforeSend?: (message: string) => void
  onSendError?: () => void
  disabled?: boolean
}

export function MessageInput({ sessionKey, sessionMode, onSent, onBeforeSend, onSendError, disabled = false }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const client = useGatewayStore((s) => s.client)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const handler = (): void => { textareaRef.current?.focus() }
    window.addEventListener('bde:focus-message-input', handler)
    return () => window.removeEventListener('bde:focus-message-input', handler)
  }, [])

  const send = useCallback(async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    if (sessionMode === 'chat' && !client) return

    setSending(true)
    setText('')
    onBeforeSend?.(trimmed)

    try {
      if (sessionMode === 'steer') {
        const steerSubAgent = useSessionsStore.getState().steerSubAgent
        await steerSubAgent(sessionKey, trimmed)
      } else {
        await client!.call('chat.send', { sessionKey, message: trimmed, idempotencyKey: crypto.randomUUID() })
      }
      onSent()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[MessageInput] send failed:', msg, { sessionKey, sessionMode })
      toast.error(`Send failed: ${msg}`)
      onSendError?.()
    } finally {
      setSending(false)
    }
  }, [text, sending, client, sessionKey, sessionMode, onSent, onBeforeSend, onSendError])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        send()
      }
    },
    [send]
  )

  const wrapperClass = sessionMode === 'steer' ? 'message-input message-input--steer' : 'message-input'

  return (
    <div className={wrapperClass}>
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={setText}
        onKeyDown={handleKeyDown}
        placeholder={sessionMode === 'steer' ? 'Redirect this agent\u2026' : 'Message...'}
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
