import React from 'react'
import type { AgentEvent, AgentEventType } from '../../../../shared/types'
import { StatusDot } from '../ui/StatusDot'
import type { StatusDotKind } from '../ui/StatusDot'
import { DrawerSection } from './primitives/DrawerSection'

interface TaskDrawerEventsProps {
  events: AgentEvent[]
}

export function TaskDrawerEvents({ events }: TaskDrawerEventsProps): React.JSX.Element {
  const recentEvents = events.slice(-8).reverse()
  return (
    <DrawerSection eyebrow="TRACE" title="Activity">
      {recentEvents.length === 0 ? (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-4)' }}>
          No activity yet
        </span>
      ) : (
        recentEvents.map((event, i) => (
          <EventRow key={i} event={event} />
        ))
      )}
    </DrawerSection>
  )
}

// --- Private helpers ---

function EventRow({ event }: { event: AgentEvent }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '40px 10px 1fr',
        gap: 'var(--s-1)',
        alignItems: 'start',
        fontFamily: 'var(--font-mono)',
        fontSize: 10
      }}
    >
      <span style={{ color: 'var(--fg-4)' }}>
        {new Date(event.timestamp).toLocaleTimeString('en', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        })}
      </span>
      <StatusDot kind={agentEventToDotKind(event.type)} size={5} />
      <span
        style={{
          color: 'var(--fg-2)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {summarizeEvent(event)}
      </span>
    </div>
  )
}

/**
 * Maps an agent event type to the appropriate status dot visual.
 * Events not matching error/done/blocked categories default to the running indicator.
 */
function agentEventToDotKind(type: AgentEventType): StatusDotKind {
  if (type === 'agent:error') return 'failed'
  if (type === 'agent:completed') return 'done'
  if (type === 'agent:stderr') return 'failed'
  return 'running'
}

/**
 * Extracts a human-readable summary string from a concrete AgentEvent shape.
 * Each branch accesses only the fields defined on that event variant,
 * preventing "[undefined]" from leaking through as output.
 */
function summarizeEvent(event: AgentEvent): string {
  switch (event.type) {
    case 'agent:text':
    case 'agent:user_message':
    case 'agent:stderr':
      return event.text
    case 'agent:tool_call':
      return `[${event.tool}] ${event.summary}`
    case 'agent:tool_result':
      return `[${event.tool}] ${event.summary}`
    case 'agent:error':
      return event.message
    case 'agent:started':
      return `Started · ${event.model}`
    case 'agent:thinking':
      return event.text ?? `Thinking (${event.tokenCount} tokens)`
    case 'agent:rate_limited':
      return `Rate limited — retry in ${event.retryDelayMs}ms`
    case 'agent:completed':
      return `Completed · exit ${event.exitCode}`
    case 'agent:mcp_disclosure':
      return `MCP: ${event.servers.join(', ')}`
    case 'agent:playground':
      return `Playground: ${event.filename}`
  }
}
