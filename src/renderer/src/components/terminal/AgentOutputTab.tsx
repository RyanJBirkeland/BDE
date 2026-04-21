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
            padding: 'var(--bde-space-4)',
            color: 'var(--bde-text-dim)',
            fontFamily: 'var(--bde-font-ui)',
            fontSize: 'var(--bde-size-md)',
            textAlign: 'center',
            marginTop: 'var(--bde-space-8)'
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
            padding: 'var(--bde-space-3)',
            fontFamily: 'var(--bde-font-code)',
            fontSize: 'var(--bde-size-md)',
            color: 'var(--bde-text)',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.5
          }}
        >
          {agentOutput.map((chunk, i) => (
            <div
              key={i}
              style={{
                borderBottom: `1px solid ${'var(--bde-border)'}`,
                paddingBottom: 'var(--bde-space-2)',
                marginBottom: 'var(--bde-space-2)'
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
          padding: 'var(--bde-space-4)',
          color: 'var(--bde-text-dim)',
          fontFamily: 'var(--bde-font-ui)',
          fontSize: 'var(--bde-size-md)',
          textAlign: 'center',
          marginTop: 'var(--bde-space-8)'
        }}
      >
        Waiting for agent output…
      </div>
    </div>
  )
}
