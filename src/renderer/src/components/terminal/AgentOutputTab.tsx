import { useEffect } from 'react'
import { ChatRenderer } from '../agents/ChatRenderer'
import { useAgentEventsStore } from '../../stores/agentEvents'
import { tokens } from '../../design-system/tokens'

interface AgentOutputTabProps {
  agentId: string
  agentOutput?: string[]
  sessionKey?: string
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

  // Agent events available — use ChatRenderer
  if (events && events.length > 0) {
    return (
      <div className="terminal-agent-tab">
        <ChatRenderer events={events} />
      </div>
    )
  }

  // Gateway session — plain text fallback (no AgentEvent source)
  if (sessionKey) {
    return (
      <div className="terminal-agent-tab">
        <div
          style={{
            padding: tokens.space[4],
            color: tokens.color.textDim,
            fontFamily: tokens.font.ui,
            fontSize: tokens.size.md,
            textAlign: 'center',
            marginTop: tokens.space[8]
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
            padding: tokens.space[3],
            fontFamily: tokens.font.code,
            fontSize: tokens.size.md,
            color: tokens.color.text,
            whiteSpace: 'pre-wrap',
            lineHeight: 1.5
          }}
        >
          {agentOutput.map((chunk, i) => (
            <div
              key={i}
              style={{
                borderBottom: `1px solid ${tokens.color.border}`,
                paddingBottom: tokens.space[2],
                marginBottom: tokens.space[2]
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
          padding: tokens.space[4],
          color: tokens.color.textDim,
          fontFamily: tokens.font.ui,
          fontSize: tokens.size.md,
          textAlign: 'center',
          marginTop: tokens.space[8]
        }}
      >
        Waiting for agent output…
      </div>
    </div>
  )
}
