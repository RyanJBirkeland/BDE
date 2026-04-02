import { useAgentHistoryStore } from '../../stores/agentHistory'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { useShallow } from 'zustand/react/shallow'
import type { NeonAccent } from '../neon/types'
import { AgentPill } from './AgentPill'

interface LiveActivityStripProps {
  onSelectAgent: (id: string) => void
}

export function LiveActivityStrip({ onSelectAgent }: LiveActivityStripProps) {
  const agents = useAgentHistoryStore((state) => state.agents)
  const runningAgents = agents.filter((agent) => agent.status === 'running')

  // Only subscribe to events for running agents to avoid unnecessary re-renders
  const events = useAgentEventsStore(
    useShallow((state) => {
      const relevantEvents: Record<string, typeof state.events[string]> = {}
      for (const agent of runningAgents) {
        relevantEvents[agent.id] = state.events[agent.id]
      }
      return relevantEvents
    })
  )

  const getLatestAction = (agentId: string): string => {
    const agentEvents = events[agentId]
    if (!agentEvents || agentEvents.length === 0) {
      return 'Starting…'
    }
    const latestEvent = agentEvents[agentEvents.length - 1]

    switch (latestEvent.type) {
      case 'agent:started':
        return `Started with ${latestEvent.model}`
      case 'agent:thinking':
        return 'Thinking…'
      case 'agent:tool_call':
        return latestEvent.summary || `Calling ${latestEvent.tool}`
      case 'agent:tool_result':
        return latestEvent.summary || `${latestEvent.tool} completed`
      case 'agent:text':
        return latestEvent.text
      case 'agent:user_message':
        return 'User message'
      case 'agent:rate_limited':
        return `Rate limited (retry in ${Math.round(latestEvent.retryDelayMs / 1000)}s)`
      case 'agent:error':
        return latestEvent.message
      case 'agent:completed':
        return 'Completed'
      case 'agent:playground':
        return `Playground: ${latestEvent.filename}`
      default:
        return 'Running…'
    }
  }

  const getAccent = (status: string): NeonAccent => {
    switch (status) {
      case 'running':
        return 'cyan'
      case 'done':
        return 'purple'
      case 'failed':
        return 'red'
      case 'cancelled':
        return 'orange'
      default:
        return 'cyan'
    }
  }

  if (runningAgents.length === 0) {
    return (
      <div className="live-strip">
        <span style={{ color: 'var(--neon-text-muted, rgba(255,255,255,0.4))', fontSize: '13px' }}>
          No agents active
        </span>
        <button
          style={{
            padding: '6px 12px',
            borderRadius: '8px',
            background: 'var(--neon-purple-surface)',
            border: '1px solid var(--neon-purple-border)',
            color: 'var(--neon-purple)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 150ms ease'
          }}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('bde:open-spawn-modal'))
          }}
        >
          Spawn Agent
        </button>
      </div>
    )
  }

  return (
    <div className="live-strip">
      {runningAgents.map((agent) => (
        <AgentPill
          key={agent.id}
          agent={agent}
          currentAction={getLatestAction(agent.id)}
          accent={getAccent(agent.status)}
          onClick={() => onSelectAgent(agent.id)}
        />
      ))}
    </div>
  )
}
