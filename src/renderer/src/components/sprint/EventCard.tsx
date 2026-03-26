/**
 * Renders a single TaskOutputEvent as a structured card in the LogDrawer.
 */
import { useState } from 'react'
import {
  Play,
  Wrench,
  Check,
  X,
  Brain,
  Clock,
  AlertTriangle,
  Terminal,
  Flag,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { tokens } from '../../design-system/tokens'
import type {
  AgentStartedEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentThinkingEvent,
  AgentRateLimitedEvent,
  AgentErrorEvent,
  AgentStderrEvent,
  AgentCompletedEvent
} from '../../../../shared/queue-api-contract'
import type { AnyTaskEvent } from '../../stores/sprintEvents'

type Props = {
  event: AnyTaskEvent
}

/** Widens the timestamp field to accept both ISO string (TaskOutputEvent) and epoch ms (AgentEvent). */
type WithFlexTimestamp<T extends { timestamp: string }> = Omit<T, 'timestamp'> & {
  timestamp: string | number
}

function formatTime(timestamp: string | number): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return ''
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remSecs = secs % 60
  return `${mins}m ${remSecs}s`
}

function formatCost(usd: number | null): string {
  if (usd === null) return '--'
  return `$${usd.toFixed(4)}`
}

const cardBase: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: tokens.space[1],
  padding: `${tokens.space[2]} ${tokens.space[3]}`,
  borderRadius: tokens.radius.sm,
  fontSize: tokens.size.sm,
  borderLeft: `3px solid ${tokens.color.border}`
}

function StartedCard({ event }: { event: WithFlexTimestamp<AgentStartedEvent> }) {
  return (
    <div
      style={{ ...cardBase, borderLeftColor: tokens.color.info }}
      data-testid="event-card-started"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          color: tokens.color.textMuted
        }}
      >
        <Play size={14} />
        <span>Agent started</span>
        <span style={{ color: tokens.color.textDim }}>{event.model}</span>
        <span style={{ marginLeft: 'auto', color: tokens.color.textDim, fontSize: tokens.size.xs }}>
          {formatTime(event.timestamp)}
        </span>
      </div>
    </div>
  )
}

function ToolCallCard({ event }: { event: WithFlexTimestamp<AgentToolCallEvent> }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      style={{ ...cardBase, borderLeftColor: tokens.color.accent }}
      data-testid="event-card-tool_call"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2] }}>
        <Wrench size={14} style={{ color: tokens.color.accent }} />
        <span
          style={{
            background: tokens.color.accentDim,
            color: tokens.color.accent,
            padding: `0 ${tokens.space[1]}`,
            borderRadius: tokens.radius.sm,
            fontSize: tokens.size.xs,
            fontFamily: tokens.font.code
          }}
        >
          {event.tool}
        </span>
        <span style={{ color: tokens.color.text }}>{event.summary}</span>
        {event.input && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: tokens.color.textDim,
              padding: 0,
              display: 'flex',
              alignItems: 'center'
            }}
            aria-label={expanded ? 'Collapse input' : 'Expand input'}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        <span
          style={{
            marginLeft: event.input ? undefined : 'auto',
            color: tokens.color.textDim,
            fontSize: tokens.size.xs
          }}
        >
          {formatTime(event.timestamp)}
        </span>
      </div>
      {expanded && event.input && (
        <pre
          style={{
            margin: 0,
            padding: tokens.space[2],
            background: tokens.color.surface,
            borderRadius: tokens.radius.sm,
            fontSize: tokens.size.xs,
            fontFamily: tokens.font.code,
            color: tokens.color.textMuted,
            overflow: 'auto',
            maxHeight: '200px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        >
          {event.input}
        </pre>
      )}
    </div>
  )
}

function ToolResultCard({ event }: { event: WithFlexTimestamp<AgentToolResultEvent> }) {
  const isSuccess = event.success

  return (
    <div
      style={{
        ...cardBase,
        borderLeftColor: isSuccess ? tokens.color.success : tokens.color.danger
      }}
      data-testid="event-card-tool_result"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2] }}>
        {isSuccess ? (
          <Check size={14} style={{ color: tokens.color.success }} />
        ) : (
          <X size={14} style={{ color: tokens.color.danger }} />
        )}
        <span
          style={{
            background: isSuccess ? tokens.color.accentDim : tokens.color.dangerDim,
            color: isSuccess ? tokens.color.success : tokens.color.danger,
            padding: `0 ${tokens.space[1]}`,
            borderRadius: tokens.radius.sm,
            fontSize: tokens.size.xs
          }}
        >
          {isSuccess ? 'success' : 'failed'}
        </span>
        <span style={{ color: tokens.color.text }}>{event.summary}</span>
        <span style={{ marginLeft: 'auto', color: tokens.color.textDim, fontSize: tokens.size.xs }}>
          {formatTime(event.timestamp)}
        </span>
      </div>
    </div>
  )
}

function ThinkingCard({ event }: { event: WithFlexTimestamp<AgentThinkingEvent> }) {
  return (
    <div
      style={{ ...cardBase, borderLeftColor: tokens.color.info }}
      data-testid="event-card-thinking"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          color: tokens.color.textMuted
        }}
      >
        <Brain size={14} />
        <span>{event.tokenCount.toLocaleString()} tokens</span>
        <span style={{ marginLeft: 'auto', color: tokens.color.textDim, fontSize: tokens.size.xs }}>
          {formatTime(event.timestamp)}
        </span>
      </div>
    </div>
  )
}

function RateLimitedCard({ event }: { event: WithFlexTimestamp<AgentRateLimitedEvent> }) {
  return (
    <div
      style={{
        ...cardBase,
        borderLeftColor: tokens.color.warning,
        background: tokens.color.warningDim
      }}
      data-testid="event-card-rate_limited"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          color: tokens.color.warning
        }}
      >
        <Clock size={14} />
        <span>
          Rate limited — retrying in {formatDuration(event.retryDelayMs)} (attempt {event.attempt})
        </span>
      </div>
    </div>
  )
}

function StderrCard({ event }: { event: WithFlexTimestamp<AgentStderrEvent> }) {
  return (
    <div
      style={{ ...cardBase, borderLeftColor: tokens.color.warning }}
      data-testid="event-card-stderr"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          color: tokens.color.warning
        }}
      >
        <Terminal size={14} />
        <span style={{ fontFamily: tokens.font.code, fontSize: tokens.size.xs }}>{event.text}</span>
      </div>
    </div>
  )
}

function ErrorCard({ event }: { event: WithFlexTimestamp<AgentErrorEvent> }) {
  return (
    <div
      style={{
        ...cardBase,
        borderLeftColor: tokens.color.danger,
        background: tokens.color.dangerDim
      }}
      data-testid="event-card-error"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
          color: tokens.color.danger
        }}
      >
        <AlertTriangle size={14} />
        <span>{event.message}</span>
      </div>
    </div>
  )
}

function CompletedCard({ event }: { event: WithFlexTimestamp<AgentCompletedEvent> }) {
  const isSuccess = event.exitCode === 0

  return (
    <div
      style={{
        ...cardBase,
        borderLeftColor: isSuccess ? tokens.color.success : tokens.color.danger
      }}
      data-testid="event-card-completed"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2] }}>
        <Flag size={14} style={{ color: isSuccess ? tokens.color.success : tokens.color.danger }} />
        <span style={{ color: tokens.color.text, fontWeight: 600 }}>
          Completed (exit {event.exitCode})
        </span>
        <span style={{ marginLeft: 'auto', color: tokens.color.textDim, fontSize: tokens.size.xs }}>
          {formatTime(event.timestamp)}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          gap: tokens.space[4],
          color: tokens.color.textMuted,
          fontSize: tokens.size.xs
        }}
      >
        <span>Duration: {formatDuration(event.durationMs)}</span>
        <span>Cost: {formatCost(event.costUsd)}</span>
        {event.tokensIn !== null && <span>In: {event.tokensIn.toLocaleString()}</span>}
        {event.tokensOut !== null && <span>Out: {event.tokensOut.toLocaleString()}</span>}
      </div>
    </div>
  )
}

export function EventCard({ event }: Props): React.JSX.Element {
  switch (event.type) {
    case 'agent:started':
      return <StartedCard event={event as WithFlexTimestamp<AgentStartedEvent>} />
    case 'agent:tool_call':
      return <ToolCallCard event={event as WithFlexTimestamp<AgentToolCallEvent>} />
    case 'agent:tool_result':
      return <ToolResultCard event={event as WithFlexTimestamp<AgentToolResultEvent>} />
    case 'agent:thinking':
      return <ThinkingCard event={event as WithFlexTimestamp<AgentThinkingEvent>} />
    case 'agent:rate_limited':
      return <RateLimitedCard event={event as WithFlexTimestamp<AgentRateLimitedEvent>} />
    case 'agent:stderr':
      return <StderrCard event={event as WithFlexTimestamp<AgentStderrEvent>} />
    case 'agent:error':
      return <ErrorCard event={event as WithFlexTimestamp<AgentErrorEvent>} />
    case 'agent:completed':
      return <CompletedCard event={event as WithFlexTimestamp<AgentCompletedEvent>} />
    default:
      return (
        <div style={cardBase} data-testid="event-card-unknown">
          <span style={{ color: tokens.color.textDim }}>{event.type}</span>
        </div>
      )
  }
}
