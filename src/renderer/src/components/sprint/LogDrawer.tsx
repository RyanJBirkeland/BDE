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
import { subscribeSSE, type LogChunkEvent, type LogDoneEvent } from '../../lib/taskRunnerSSE'
import { TASK_STATUS, AGENT_STATUS } from '../../../../shared/constants'
import type { TaskOutputEvent } from '../../../../shared/queue-api-contract'
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
  const [initialEvents, setInitialEvents] = useState<TaskOutputEvent[]>([])
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
    setInitialEvents([])
  }, [task?.agent_run_id])

  // Effect: fetch initial events when opening drawer for a task
  useEffect(() => {
    if (!task?.id) return
    const taskId = task.id
    let cancelled = false
    window.api.task.getEvents(taskId).then((events) => {
      if (!cancelled && events.length > 0) {
        setInitialEvents(events)
      }
    }).catch(() => {
      // Silently ignore — events may not be available
    })
    return () => { cancelled = true }
  }, [task?.id])

  // Effect 2: catch-up read + SSE subscription for live streaming
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

    if (!isActive) return () => { cancelled = true }

    // Real-time SSE for active tasks
    const unsubChunk = subscribeSSE('log:chunk', (data: unknown) => {
      const ev = data as LogChunkEvent
      if (ev.agentId !== agentId) return
      // Handle partial overlap: slice off bytes we already have
      const overlap = fromByteRef.current - ev.fromByte
      const text = overlap > 0 ? ev.content.slice(overlap) : ev.content
      if (text.length === 0) return
      const cleaned = stripAnsi(text)
      setLogContent((prev) => prev + cleaned)
      fromByteRef.current = ev.fromByte + new TextEncoder().encode(ev.content).length
    })

    const unsubDone = subscribeSSE('log:done', (data: unknown) => {
      const ev = data as LogDoneEvent
      if (ev.agentId !== agentId) return
      setExitCode(ev.exitCode)
      setAgentStatus(ev.exitCode === 0 ? AGENT_STATUS.DONE : AGENT_STATUS.FAILED)
      catchUp() // final catch-up in case we missed chunks
    })

    return () => {
      cancelled = true
      unsubChunk()
      unsubDone()
    }
  }, [task?.agent_run_id, task?.status])

  // Effect: load agentEvents history when drawer opens for a task
  useEffect(() => {
    if (task?.agent_run_id) {
      loadHistory(task.agent_run_id)
    }
  }, [task?.agent_run_id, loadHistory])

  // Merge initial events with live store events, deduplicating by timestamp+type
  const mergedEvents = useMemo(() => {
    const live = storeEvents ?? []
    if (initialEvents.length === 0) return live
    if (live.length === 0) return initialEvents
    const seen = new Set(live.map((e) => `${e.timestamp}:${e.type}`))
    const unique = initialEvents.filter((e) => !seen.has(`${e.timestamp}:${e.type}`))
    return [...unique, ...live]
  }, [initialEvents, storeEvents])

  // Collapse consecutive thinking events (keep only the latest)
  const displayEvents = useMemo(() => {
    const result: TaskOutputEvent[] = []
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
