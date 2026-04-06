import { useEffect } from 'react'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useCodeReviewStore } from '../../stores/codeReview'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { renderAgentMarkdown } from '../../lib/render-agent-markdown'
import { EmptyState } from '../ui/EmptyState'
import type { AgentEvent } from '../../../../shared/types'
import { Terminal, Wrench, AlertTriangle, CheckCircle, MessageSquare, Brain } from 'lucide-react'

function EventItem({ event }: { event: AgentEvent }): React.JSX.Element {
  const time = new Date(event.timestamp).toLocaleTimeString()

  switch (event.type) {
    case 'agent:text':
      return (
        <div className="cr-event cr-event--text">
          <MessageSquare size={12} className="cr-event__icon" />
          <div className="cr-event__body">
            <span className="cr-event__time">{time}</span>
            <div className="cr-event__content">{event.text}</div>
          </div>
        </div>
      )
    case 'agent:tool_call':
      return (
        <div className="cr-event cr-event--tool">
          <Wrench size={12} className="cr-event__icon" />
          <div className="cr-event__body">
            <span className="cr-event__time">{time}</span>
            <span className="cr-event__tool-name">{event.tool}</span>
            <span className="cr-event__summary">{event.summary}</span>
          </div>
        </div>
      )
    case 'agent:tool_result':
      return (
        <div
          className={`cr-event cr-event--result ${event.success ? '' : 'cr-event--result-fail'}`}
        >
          <Terminal size={12} className="cr-event__icon" />
          <div className="cr-event__body">
            <span className="cr-event__time">{time}</span>
            <span className="cr-event__tool-name">{event.tool}</span>
            <span className="cr-event__summary">{event.summary}</span>
          </div>
        </div>
      )
    case 'agent:thinking':
      return (
        <div className="cr-event cr-event--thinking">
          <Brain size={12} className="cr-event__icon" />
          <div className="cr-event__body">
            <span className="cr-event__time">{time}</span>
            <span className="cr-event__summary">Thinking... ({event.tokenCount} tokens)</span>
          </div>
        </div>
      )
    case 'agent:error':
      return (
        <div className="cr-event cr-event--error">
          <AlertTriangle size={12} className="cr-event__icon" />
          <div className="cr-event__body">
            <span className="cr-event__time">{time}</span>
            <div className="cr-event__content cr-event__content--error">{event.message}</div>
          </div>
        </div>
      )
    case 'agent:completed':
      return (
        <div className="cr-event cr-event--completed">
          <CheckCircle size={12} className="cr-event__icon" />
          <div className="cr-event__body">
            <span className="cr-event__time">{time}</span>
            <span className="cr-event__summary">
              Completed (exit {event.exitCode}) — ${event.costUsd.toFixed(2)} ·{' '}
              {Math.round(event.durationMs / 1000)}s
            </span>
          </div>
        </div>
      )
    default:
      return <></>
  }
}

export function ConversationTab(): React.JSX.Element {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const tasks = useSprintTasks((s) => s.tasks)
  const loadHistory = useAgentEventsStore((s) => s.loadHistory)
  const task = tasks.find((t) => t.id === selectedTaskId)

  const agentRunId = task?.agent_run_id ?? null
  const agentEvents = useAgentEventsStore((s) =>
    agentRunId ? (s.events[agentRunId] ?? null) : null
  )

  useEffect(() => {
    if (agentRunId) {
      loadHistory(agentRunId)
    }
  }, [agentRunId, loadHistory])

  if (!task) return <div className="cr-placeholder">No task selected</div>

  // If no agent_run_id, fall back to spec/notes display
  if (!agentRunId) {
    return (
      <div className="cr-conversation">
        <div className="cr-conversation__section">
          <h4 className="cr-conversation__heading">Task Spec</h4>
          <div className="cr-conversation__spec">
            {task.spec ? (
              renderAgentMarkdown(task.spec)
            ) : (
              <span className="cr-placeholder">No spec available</span>
            )}
          </div>
        </div>
        {task.notes && (
          <div className="cr-conversation__section">
            <h4 className="cr-conversation__heading">Agent Notes</h4>
            <div className="cr-conversation__notes">{task.notes}</div>
          </div>
        )}
      </div>
    )
  }

  // Loading state: agent_run_id exists but events not loaded yet
  if (!agentEvents) {
    return (
      <div className="cr-conversation" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
        <div className="bde-skeleton" style={{ height: 40 }} />
        <div className="bde-skeleton" style={{ height: 40 }} />
        <div className="bde-skeleton" style={{ height: 40 }} />
        <div className="bde-skeleton" style={{ height: 40 }} />
      </div>
    )
  }

  // Empty events
  if (agentEvents.length === 0) {
    return <EmptyState message="No conversation events recorded for this agent run." />
  }

  return (
    <div className="cr-conversation cr-conversation--events">
      {agentEvents.map((event, i) => (
        <EventItem key={`${event.type}-${event.timestamp}-${i}`} event={event} />
      ))}
    </div>
  )
}
