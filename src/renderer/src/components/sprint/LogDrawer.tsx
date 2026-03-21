import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { stripAnsi } from '../../lib/stream-parser'
import { ChatRenderer } from '../agents/ChatRenderer'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { EventCard } from './EventCard'
import { Button } from '../ui/Button'
import { tokens } from '../../design-system/tokens'
import { toast } from '../../stores/toasts'
import { useSprintEvents } from '../../stores/sprintEvents'
import { TASK_STATUS, AGENT_STATUS } from '../../../../shared/constants'
import type { AnyTaskEvent } from '../../stores/sprintEvents'
import type { SprintTask } from './SprintCenter'

type LogDrawerProps = {
  task: SprintTask | null
  onClose: () => void
  onStop?: (task: SprintTask) => void
  onRerun?: (task: SprintTask) => void
}

export function LogDrawer({ task, onClose, onStop, onRerun }: LogDrawerProps): React.JSX.Element | null {
  const [logContent, setLogContent] = useState('')
  const [agentStatus, setAgentStatus] = useState('unknown')
  const [steerInput, setSteerInput] = useState('')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const fromByteRef = useRef(0)

  // Streaming events from the store
  const storeEvents = useSprintEvents((s) => (task ? s.taskEvents[task.id] : undefined))

  // AgentEvents store for ChatRenderer
  const agentEvents = useAgentEventsStore((s) =>
    task?.agent_run_id ? s.events[task.agent_run_id] : undefined
  )
  const loadHistory = useAgentEventsStore((s) => s.loadHistory)

  // Effect 1: reset state only when switching to a different agent
  useEffect(() => {
    fromByteRef.current = 0
    setLogContent('')
    setAgentStatus(AGENT_STATUS.UNKNOWN)
    setExitCode(null)
  }, [task?.agent_run_id])

  // Effect 2: catch-up read for log content (polls via readLog IPC)
  useEffect(() => {
    if (!task?.agent_run_id) return
    const agentId = task.agent_run_id
    const isActive = task.status === TASK_STATUS.ACTIVE

    let cancelled = false

    const catchUp = async (): Promise<void> => {
      try {
        const result = await window.api.sprint.readLog(agentId, fromByteRef.current)
        if (cancelled) return
        if (result.content) {
          setLogContent((prev) => prev + stripAnsi(result.content))
          fromByteRef.current = result.nextByte
        }
        setAgentStatus(result.status)
      } catch {
        // Log may not exist yet
      }
    }

    catchUp()

    // For active tasks, poll periodically for new log content
    if (!isActive) return () => { cancelled = true }

    const interval = setInterval(catchUp, 2000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [task?.agent_run_id, task?.status])

  // Effect: load agentEvents history when drawer opens for a task
  useEffect(() => {
    if (task?.agent_run_id) {
      loadHistory(task.agent_run_id)
    }
  }, [task?.agent_run_id, loadHistory])

  const mergedEvents = useMemo(() => storeEvents ?? [], [storeEvents])

  // Collapse consecutive thinking events (keep only the latest)
  const displayEvents = useMemo(() => {
    const result: AnyTaskEvent[] = []
    for (const ev of mergedEvents) {
      if (ev.type === 'agent:thinking' && result.length > 0 && result[result.length - 1].type === 'agent:thinking') {
        result[result.length - 1] = ev
      } else {
        result.push(ev)
      }
    }
    return result
  }, [mergedEvents])

  const hasEvents = displayEvents.length > 0
  const hasPlainText = logContent.trim().length > 0

  const canSteer = task?.status === TASK_STATUS.ACTIVE && !!task?.agent_run_id

  const handleSteerSend = useCallback(async () => {
    const msg = steerInput.trim()
    if (!msg || !task?.agent_run_id) return
    setSteerInput('')
    try {
      const result = await window.api.steerAgent(task.agent_run_id, msg)
      if (!result.ok) {
        toast.error(result.error ?? 'Failed to send message to agent')
      }
    } catch {
      toast.error('Failed to send message')
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

  const handleOpenInAgents = useCallback(() => {
    if (!task?.agent_run_id) return
    window.dispatchEvent(
      new CustomEvent('bde:navigate', {
        detail: { view: 'agents', sessionId: task.agent_run_id },
      })
    )
    onClose()
  }, [task?.agent_run_id, onClose])

  const handleCopyLog = useCallback(async () => {
    await navigator.clipboard.writeText(logContent)
    toast.success('Copied!')
  }, [logContent])

  if (!task) return null

  const shortId = task.agent_run_id?.slice(0, 8) ?? '?'
  const statusLabel =
    agentStatus === AGENT_STATUS.RUNNING
      ? '\u25CF running'
      : agentStatus === AGENT_STATUS.DONE
        ? '\u2713 done'
        : agentStatus === AGENT_STATUS.FAILED
          ? `\u2717 failed${exitCode !== null ? ` \u00B7 exit ${exitCode}` : ''}`
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
          hasEvents ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1], padding: tokens.space[2] }}>
              {displayEvents.map((ev, i) => (
                <EventCard key={`${ev.timestamp}-${ev.type}-${i}`} event={ev} />
              ))}
            </div>
          ) : agentEvents && agentEvents.length > 0 ? (
            <ChatRenderer events={agentEvents} />
          ) : hasPlainText ? (
            <pre className="log-drawer__plain-text">{stripAnsi(logContent)}</pre>
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
        {task.status === TASK_STATUS.ACTIVE && onStop && (
          <Button variant="danger" size="sm" onClick={() => onStop(task)}>
            Stop Agent
          </Button>
        )}
        {onRerun && (agentStatus === AGENT_STATUS.FAILED || (task.status === TASK_STATUS.DONE && !task.pr_url)) && (
          <Button variant="ghost" size="sm" onClick={() => onRerun(task)}>
            <RefreshCw size={14} /> Re-run
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={handleOpenInAgents}>
          Open in Agents
        </Button>
        <Button variant="ghost" size="sm" onClick={handleCopyLog} title="Copy log to clipboard">
          <Copy size={14} /> Copy Log
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}
