import { useEffect, useMemo } from 'react'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { pairEvents } from '../../lib/pair-events'
import { ConsoleCard } from '../agents/cards/ConsoleCard'

interface AgentOutputTabProps {
  agentId: string
  agentOutput?: string[] | undefined
  sessionKey?: string | undefined
}

export function AgentOutputTab({
  agentId,
  agentOutput,
  sessionKey
}: AgentOutputTabProps): React.JSX.Element {
  const events = useAgentEventsStore((s) => s.events[agentId])
  const loadHistory = useAgentEventsStore((s) => s.loadHistory)

  useEffect(() => {
    if (agentId) {
      loadHistory(agentId)
    }
  }, [agentId, loadHistory])

  const blocks = useMemo(() => (events ? pairEvents(events) : []), [events])

  // Agent events available — use ConsoleCard renderer
  if (events && events.length > 0) {
    return (
      <div className="terminal-agent-tab">
        {blocks.map((block, i) => (
          <ConsoleCard key={i} block={block} />
        ))}
      </div>
    )
  }

  // Gateway session — plain text fallback (no AgentEvent source)
  if (sessionKey) {
    return (
      <div className="terminal-agent-tab">
        <div
          style={{
            padding: 'var(--fleet-space-4)',
            color: 'var(--fleet-text-dim)',
            fontFamily: 'var(--fleet-font-ui)',
            fontSize: 'var(--fleet-size-md)',
            textAlign: 'center',
            marginTop: 'var(--fleet-space-8)'
          }}
        >
          Waiting for agent output…
        </div>
      </div>
    )
  }

  // Legacy plaintext output
  if (agentOutput && agentOutput.length > 0) {
    return (
      <div className="terminal-agent-tab">
        <div
          style={{
            padding: 'var(--fleet-space-3)',
            fontFamily: 'var(--fleet-font-code)',
            fontSize: 'var(--fleet-size-md)',
            color: 'var(--fleet-text)',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.5
          }}
        >
          {agentOutput.map((chunk, i) => (
            <div
              key={i}
              style={{
                borderBottom: `1px solid ${'var(--fleet-border)'}`,
                paddingBottom: 'var(--fleet-space-2)',
                marginBottom: 'var(--fleet-space-2)'
              }}
            >
              {chunk}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Empty state
  return (
    <div className="terminal-agent-tab">
      <div
        style={{
          padding: 'var(--fleet-space-4)',
          color: 'var(--fleet-text-dim)',
          fontFamily: 'var(--fleet-font-ui)',
          fontSize: 'var(--fleet-size-md)',
          textAlign: 'center',
          marginTop: 'var(--fleet-space-8)'
        }}
      >
        Waiting for agent output…
      </div>
    </div>
  )
}
