import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { parseStreamJson } from '../../lib/stream-parser'
import { chatItemsToMessages } from '../../lib/agent-messages'
import type { ChatMessage } from '../../lib/agent-messages'
import { ChatThread } from '../sessions/ChatThread'
import { Button } from '../ui/Button'
import { toast } from '../../stores/toasts'
import type { SprintTask } from './SprintCenter'

const LOG_POLL_INTERVAL = 2_000

type LogDrawerProps = {
  task: SprintTask | null
  onClose: () => void
}

export function LogDrawer({ task, onClose }: LogDrawerProps): React.JSX.Element | null {
  const [logContent, setLogContent] = useState('')
  const [agentStatus, setAgentStatus] = useState('unknown')
  const [steerInput, setSteerInput] = useState('')
  const [sentMessages, setSentMessages] = useState<ChatMessage[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!task?.agent_run_id) return

    setLogContent('')
    setAgentStatus('unknown')
    setSentMessages([])

    const fetchLog = async (): Promise<void> => {
      try {
        const result = await window.api.sprint.readLog(task.agent_run_id!)
        setLogContent(result.content)
        setAgentStatus(result.status)
      } catch {
        // Non-critical — drawer will show empty state
      }
    }

    fetchLog()

    const isActive = task.status === 'active'
    if (isActive) {
      pollRef.current = setInterval(fetchLog, LOG_POLL_INTERVAL)
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [task?.agent_run_id, task?.status])

  const { items, isStreaming } = useMemo(() => parseStreamJson(logContent), [logContent])
  const messages = useMemo(() => chatItemsToMessages(items), [items])

  const allMessages = useMemo(
    () => [...messages, ...sentMessages],
    [messages, sentMessages]
  )

  const hasStreamJson = items.length > 0
  const hasPlainText = !hasStreamJson && logContent.trim().length > 0

  const canSteer = task?.status === 'active' && !!task?.agent_run_id

  const handleSteerSend = useCallback(async () => {
    const msg = steerInput.trim()
    if (!msg || !task?.agent_run_id) return
    setSentMessages((prev) => [
      ...prev,
      { role: 'user', content: msg, timestamp: Date.now() }
    ])
    setSteerInput('')
    const result = await window.api.steerAgent(task.agent_run_id, msg)
    if (!result.ok) {
      toast.error(result.error ?? 'Failed to send message to agent')
    }
  }, [steerInput, task?.agent_run_id])

  const handleSteerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSteerSend()
      }
    },
    [handleSteerSend]
  )

  const handleOpenInSessions = useCallback(() => {
    if (!task?.agent_run_id) return
    window.dispatchEvent(
      new CustomEvent('bde:navigate', {
        detail: { view: 'sessions', sessionId: task.agent_run_id },
      })
    )
    onClose()
  }, [task?.agent_run_id, onClose])

  if (!task) return null

  const shortId = task.agent_run_id?.slice(0, 8) ?? '?'
  const statusLabel =
    agentStatus === 'running'
      ? '\u25CF running'
      : agentStatus === 'done'
        ? '\u2713 done'
        : agentStatus === 'failed'
          ? '\u2717 failed'
          : agentStatus

  return (
    <div className="log-drawer">
      <div className="log-drawer__header">
        <span className="log-drawer__title">agent/{shortId}</span>
        <span className="log-drawer__meta">{task.repo}</span>
        <span className="log-drawer__meta">{statusLabel}</span>
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={onClose}>
          {'\u2715'}
        </Button>
      </div>
      <div className="log-drawer__body">
        {task.agent_run_id ? (
          hasStreamJson ? (
            <ChatThread messages={allMessages} isStreaming={agentStatus === 'running' && isStreaming} />
          ) : hasPlainText ? (
            <pre className="log-drawer__plain-text">{logContent}</pre>
          ) : (
            <div className="log-drawer__empty">Agent is starting up...</div>
          )
        ) : (
          <div className="log-drawer__no-session">No agent session linked to this task.</div>
        )}
      </div>
      {canSteer && (
        <div className="agent-steer-input">
          <input
            className="agent-steer-input__field"
            type="text"
            placeholder="Send message to agent\u2026"
            value={steerInput}
            onChange={(e) => setSteerInput(e.target.value)}
            onKeyDown={handleSteerKeyDown}
          />
          <button
            className="agent-steer-input__send"
            onClick={handleSteerSend}
            disabled={!steerInput.trim()}
          >
            Send {'\u2192'}
          </button>
        </div>
      )}
      <div className="log-drawer__footer">
        <Button variant="ghost" size="sm" onClick={handleOpenInSessions}>
          Open in Sessions
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}
