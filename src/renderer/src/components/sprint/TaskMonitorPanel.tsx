import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { EventCard } from './EventCard'
import { ChatRenderer } from '../agents/ChatRenderer'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { useSprintEvents } from '../../stores/sprintEvents'
import { stripAnsi } from '../../lib/stream-parser'
import { tokens } from '../../design-system/tokens'
import { toast } from '../../stores/toasts'
import { TASK_STATUS, AGENT_STATUS } from '../../../../shared/constants'
import type { AnyTaskEvent } from '../../stores/sprintEvents'
import type { SprintTask } from './SprintCenter'

interface TaskMonitorPanelProps {
  task: SprintTask
  onClose: () => void
  onStop?: (task: SprintTask) => void
  onRerun?: (task: SprintTask) => void
}

function statusBadgeVariant(status: string): 'default' | 'success' | 'danger' | 'warning' | 'info' {
  switch (status) {
    case TASK_STATUS.ACTIVE:
      return 'success'
    case TASK_STATUS.DONE:
      return 'info'
    case TASK_STATUS.FAILED:
    case TASK_STATUS.ERROR:
      return 'danger'
    case TASK_STATUS.BLOCKED:
      return 'warning'
    default:
      return 'default'
  }
}

export function TaskMonitorPanel({
  task,
  onClose,
  onStop,
  onRerun
}: TaskMonitorPanelProps): React.JSX.Element {
  const [logContent, setLogContent] = useState('')
  const [agentStatus, setAgentStatus] = useState('unknown')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const fromByteRef = useRef(0)

  const storeEvents = useSprintEvents((s) => s.taskEvents[task.id])
  const agentEvents = useAgentEventsStore((s) =>
    task.agent_run_id ? s.events[task.agent_run_id] : undefined
  )
  const loadHistory = useAgentEventsStore((s) => s.loadHistory)

  // Reset state when switching to a different agent
  useEffect(() => {
    fromByteRef.current = 0
    setLogContent('')
    setAgentStatus(AGENT_STATUS.UNKNOWN)
    setExitCode(null)
  }, [task.agent_run_id])

  // Catch-up read for log content
  useEffect(() => {
    if (!task.agent_run_id) return
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

    if (!isActive)
      return () => {
        cancelled = true
      }

    const interval = setInterval(catchUp, 2000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [task.agent_run_id, task.status])

  // Load agent events history when panel opens
  useEffect(() => {
    if (task.agent_run_id) {
      loadHistory(task.agent_run_id)
    }
  }, [task.agent_run_id, loadHistory])

  const displayEvents = useMemo(() => {
    const events: AnyTaskEvent[] = storeEvents ?? []
    const result: AnyTaskEvent[] = []
    for (const ev of events) {
      if (
        ev.type === 'agent:thinking' &&
        result.length > 0 &&
        result[result.length - 1].type === 'agent:thinking'
      ) {
        result[result.length - 1] = ev
      } else {
        result.push(ev)
      }
    }
    return result
  }, [storeEvents])

  const hasEvents = displayEvents.length > 0
  const hasPlainText = logContent.trim().length > 0

  const handleOpenInAgents = useCallback(() => {
    if (!task.agent_run_id) return
    window.dispatchEvent(
      new CustomEvent('bde:navigate', {
        detail: { view: 'agents', sessionId: task.agent_run_id }
      })
    )
    onClose()
  }, [task.agent_run_id, onClose])

  const handleCopyLog = useCallback(async () => {
    await navigator.clipboard.writeText(logContent)
    toast.success('Copied!')
  }, [logContent])

  const statusLabel =
    agentStatus === AGENT_STATUS.RUNNING
      ? '\u25CF running'
      : agentStatus === AGENT_STATUS.DONE
        ? '\u2713 done'
        : agentStatus === AGENT_STATUS.FAILED
          ? `\u2717 failed${exitCode !== null ? ` \u00B7 exit ${exitCode}` : ''}`
          : agentStatus

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: tokens.color.surface,
        borderLeft: `1px solid ${tokens.color.border}`,
        fontFamily: tokens.font.ui,
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          padding: `${tokens.space[2]} ${tokens.space[3]}`,
          borderBottom: `1px solid ${tokens.color.border}`,
          flexShrink: 0
        }}
      >
        <span
          style={{
            fontSize: tokens.size.sm,
            fontWeight: 600,
            color: tokens.color.text,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={task.title}
        >
          {task.title}
        </span>
        <Badge variant={statusBadgeVariant(task.status)} size="sm">
          {task.status}
        </Badge>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close monitor panel">
          {'\u2715'}
        </Button>
      </div>

      {/* Agent status line */}
      {task.agent_run_id && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[2],
            padding: `${tokens.space[1]} ${tokens.space[3]}`,
            borderBottom: `1px solid ${tokens.color.border}`,
            fontSize: tokens.size.xs,
            color: tokens.color.textMuted,
            flexShrink: 0
          }}
        >
          <span>agent/{task.agent_run_id.slice(0, 8)}</span>
          <span>{'\u00B7'}</span>
          <span>{statusLabel}</span>
          {task.pr_url && (
            <>
              <span>{'\u00B7'}</span>
              <button
                onClick={() => window.api.openExternal(task.pr_url!)}
                title="Open PR in browser"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: tokens.color.accent,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: 0,
                  fontSize: tokens.size.xs,
                  fontFamily: tokens.font.ui
                }}
              >
                <ExternalLink size={10} aria-hidden="true" />
                PR #{task.pr_number}
              </button>
            </>
          )}
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {task.agent_run_id ? (
          hasEvents ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: tokens.space[1],
                padding: tokens.space[2]
              }}
            >
              {displayEvents.map((ev, i) => (
                <EventCard key={`${ev.timestamp}-${ev.type}-${i}`} event={ev} />
              ))}
            </div>
          ) : agentEvents && agentEvents.length > 0 ? (
            <ChatRenderer events={agentEvents} />
          ) : hasPlainText ? (
            <pre
              style={{
                padding: tokens.space[3],
                fontSize: tokens.size.sm,
                fontFamily: tokens.font.code,
                color: tokens.color.text,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}
            >
              {logContent}
            </pre>
          ) : (
            <div
              style={{
                padding: tokens.space[4],
                color: tokens.color.textMuted,
                fontSize: tokens.size.sm
              }}
            >
              Agent is starting up…
            </div>
          )
        ) : (
          <div
            style={{
              padding: tokens.space[4],
              color: tokens.color.textMuted,
              fontSize: tokens.size.sm
            }}
          >
            No agent session linked to this task.
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          padding: `${tokens.space[2]} ${tokens.space[3]}`,
          borderTop: `1px solid ${tokens.color.border}`,
          flexShrink: 0,
          flexWrap: 'wrap'
        }}
      >
        {task.status === TASK_STATUS.ACTIVE && onStop && (
          <Button variant="danger" size="sm" onClick={() => onStop(task)}>
            Stop Agent
          </Button>
        )}
        {onRerun &&
          (agentStatus === AGENT_STATUS.FAILED ||
            (task.status === TASK_STATUS.DONE && !task.pr_url)) && (
            <Button variant="ghost" size="sm" onClick={() => onRerun(task)}>
              <RefreshCw size={14} aria-hidden="true" /> Re-run
            </Button>
          )}
        {task.agent_run_id && (
          <Button variant="ghost" size="sm" onClick={handleOpenInAgents}>
            Open in Agents
          </Button>
        )}
        {hasPlainText && (
          <Button variant="ghost" size="sm" onClick={handleCopyLog} title="Copy log to clipboard">
            Copy Log
          </Button>
        )}
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}
