/**
 * Renders a compact subtitle for the latest streaming event on a task card.
 * Shows an icon + summary text using lucide-react icons and design tokens.
 */
import { Play, Wrench, Check, X, Brain, Clock, AlertTriangle, Flag } from 'lucide-react'
import { tokens } from '../../design-system/tokens'
import type { AnyTaskEvent } from '../../stores/sprintEvents'
import type {
  AgentStartedEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentThinkingEvent,
  AgentErrorEvent,
  AgentCompletedEvent
} from '../../../../shared/queue-api-contract'

type Props = {
  event: AnyTaskEvent | null
}

function getIconAndText(event: AnyTaskEvent): { icon: React.ReactNode; text: string } {
  switch (event.type) {
    case 'agent:started': {
      const e = event as AgentStartedEvent
      return { icon: <Play size={12} />, text: `Agent started (${e.model})` }
    }
    case 'agent:tool_call': {
      const e = event as AgentToolCallEvent
      return { icon: <Wrench size={12} />, text: e.summary }
    }
    case 'agent:tool_result': {
      const e = event as AgentToolResultEvent
      return {
        icon: e.success ? <Check size={12} /> : <X size={12} />,
        text: e.summary
      }
    }
    case 'agent:thinking': {
      const e = event as AgentThinkingEvent
      return { icon: <Brain size={12} />, text: `${e.tokenCount} tokens` }
    }
    case 'agent:rate_limited':
      return { icon: <Clock size={12} />, text: 'Rate limited, retrying...' }
    case 'agent:error': {
      const e = event as AgentErrorEvent
      return { icon: <AlertTriangle size={12} />, text: e.message }
    }
    case 'agent:completed': {
      const e = event as AgentCompletedEvent
      return { icon: <Flag size={12} />, text: `Completed (exit ${e.exitCode})` }
    }
    default:
      return { icon: null, text: event.type }
  }
}

export function TaskEventSubtitle({ event }: Props): React.JSX.Element | null {
  if (!event) return null

  const { icon, text } = getIconAndText(event)

  return (
    <div
      className="task-event-subtitle"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[1],
        color: tokens.color.textDim,
        fontSize: tokens.size.xs,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        marginTop: tokens.space[1]
      }}
    >
      {icon}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
    </div>
  )
}
