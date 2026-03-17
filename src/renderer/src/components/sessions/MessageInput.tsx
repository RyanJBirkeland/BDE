import { useState, useCallback, useEffect, useRef } from 'react'
import { Paperclip, X } from 'lucide-react'
import { toast } from '../../stores/toasts'
import { useGatewayStore, getGatewayClient } from '../../stores/gateway'
import { useSessionsStore } from '../../stores/sessions'
import { useLocalAgentsStore } from '../../stores/localAgents'
import { pickAndReadFiles, buildLocalAgentMessage, buildGatewayPayload } from '../../lib/attachments'
import { Textarea } from '../ui/Textarea'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import type { Attachment } from '../../../../shared/types'

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
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [localInteractive, setLocalInteractive] = useState<boolean | null>(null)
  const gatewayStatus = useGatewayStore((s) => s.status)
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

  const handleAttach = useCallback(async (): Promise<void> => {
    try {
      const newFiles = await pickAndReadFiles(attachments)
      if (newFiles.length > 0) {
        setAttachments((prev) => [...prev, ...newFiles])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    }
  }, [attachments])

  const removeAttachment = useCallback((index: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const hasContent = text.trim().length > 0 || attachments.length > 0

  const send = useCallback(async (): Promise<void> => {
    const trimmed = text.trim()
    if (!hasContent || sending) return

    if (sessionMode === 'chat' && gatewayStatus !== 'connected') {
      toast.error('Gateway not connected')
      return
    }
    if (sessionMode === 'local' && !localPid) {
      toast.error('No agent PID')
      return
    }

    setSending(true)
    setText('')
    const sentAttachments = [...attachments]
    setAttachments([])
    onBeforeSend?.(trimmed)

    try {
      if (sessionMode === 'steer') {
        const fullMessage = sentAttachments.length > 0
          ? buildLocalAgentMessage(trimmed, sentAttachments)
          : trimmed
        const steerSubAgent = useSessionsStore.getState().steerSubAgent
        await steerSubAgent(sessionKey, fullMessage)
      } else if (sessionMode === 'local') {
        const fullMessage = sentAttachments.length > 0
          ? buildLocalAgentMessage(trimmed, sentAttachments)
          : trimmed
        await sendToAgent(localPid!, fullMessage)
      } else {
        const client = getGatewayClient()
        if (!client) throw new Error('Gateway not connected')
        const payload = buildGatewayPayload(sessionKey, trimmed, sentAttachments)
        await client.call('chat.send', payload)
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
  }, [text, hasContent, sending, attachments, gatewayStatus, sessionKey, sessionMode, localPid, onSent, onBeforeSend, onSendError, sendToAgent])

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
      {attachments.length > 0 && (
        <div className="attachment-chips">
          {attachments.map((att, i) => (
            <div key={att.path + i} className="attachment-chip">
              {att.type === 'image' && att.preview ? (
                <img src={att.preview} alt={att.name} className="attachment-chip__thumb" />
              ) : (
                <span className="attachment-chip__icon">📄</span>
              )}
              <span className="attachment-chip__name">{att.name}</span>
              <button
                className="attachment-chip__remove"
                onClick={() => removeAttachment(i)}
                aria-label={`Remove ${att.name}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="message-input__row">
        <button
          className="message-input__attach"
          onClick={handleAttach}
          disabled={disabled || sending || localBlocked}
          aria-label="Attach file"
          title="Attach file"
        >
          <Paperclip size={16} />
        </button>
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
          disabled={!hasContent || sending || disabled || localBlocked}
        >
          {sending ? <Spinner size="sm" /> : 'Send'}
        </Button>
      </div>
    </div>
  )
}
