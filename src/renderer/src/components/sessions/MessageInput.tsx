import { useState, useCallback, useEffect, useRef } from 'react'
import { toast } from '../../stores/toasts'
import { useGatewayStore } from '../../stores/gateway'
import { useSessionsStore } from '../../stores/sessions'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { Textarea } from '../ui/Textarea'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

interface Props {
  sessionKey: string
  sessionMode: 'chat' | 'steer' | 'local'
  localPid?: number
  onSent: () => void
  onBeforeSend?: (message: string) => void
  onSendError?: () => void
  disabled?: boolean
}

export function MessageInput({ sessionKey, sessionMode, localPid, onSent, onBeforeSend, onSendError, disabled = false }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [localInteractive, setLocalInteractive] = useState<boolean | null>(null)
  const client = useGatewayStore((s) => s.client)
  const sendToAgent = useLocalAgentsStore((s) => s.sendToAgent)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Check if local agent has an active stdin handle
  useEffect(() => {
    if (sessionMode !== 'local' || !localPid) {
      setLocalInteractive(null)
      return
    }
    window.api.isAgentInteractive(localPid).then(setLocalInteractive).catch(() => setLocalInteractive(false))
  }, [sessionMode, localPid])

  useEffect(() => {
    const handler = (): void => { textareaRef.current?.focus() }
    window.addEventListener('bde:focus-message-input', handler)
    return () => window.removeEventListener('bde:focus-message-input', handler)
  }, [])

  const send = useCallback(async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    if (sessionMode === 'chat' && !client) {
      toast.error('Gateway not connected')
      return
    }
    if (sessionMode === 'local' && !localPid) {
      toast.error('No agent PID')
      return
    }

    setSending(true)
    setText('')
    onBeforeSend?.(trimmed)

    try {
      if (sessionMode === 'steer') {
        const steerSubAgent = useSessionsStore.getState().steerSubAgent
        await steerSubAgent(sessionKey, trimmed)
      } else if (sessionMode === 'local') {
        await sendToAgent(localPid!, trimmed)
      } else if (client) {
        await client.call('chat.send', { sessionKey, message: trimmed, idempotencyKey: crypto.randomUUID() })
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

  const localBlocked = sessionMode === 'local' && localInteractive === false
  const wrapperClass =
    sessionMode === 'steer' ? 'message-input message-input--steer' :
    sessionMode === 'local' ? 'message-input message-input--local' :
    'message-input'

  const placeholder =
    sessionMode === 'steer' ? 'Redirect this agent\u2026' :
    sessionMode === 'local' && localBlocked ? 'Agent stdin not available — spawned outside this session' :
    sessionMode === 'local' ? 'Send to agent stdin\u2026' :
    'Message\u2026 (Shift+Enter for newline)'

  return (
    <div className={wrapperClass}>
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={setText}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || sending || localBlocked}
        className="message-input__textarea"
      />
      <Button
        variant="primary"
        size="sm"
        className="message-input__send"
        onClick={send}
        disabled={!text.trim() || sending || disabled || localBlocked}
      >
        {sending ? <Spinner size="sm" /> : 'Send'}
      </Button>
    </div>
  )
}
