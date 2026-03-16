import { LocalAgentLogViewer, AgentLogViewer } from '../sessions/LocalAgentLogViewer'
import { tokens } from '../../design-system/tokens'

interface AgentOutputTabProps {
  agentId: string
  agentOutput?: string[]
}

export function AgentOutputTab({ agentId, agentOutput }: AgentOutputTabProps): React.JSX.Element {
  // Parse agentId format: either "local:pid" or a UUID
  const isLocalAgent = agentId.startsWith('local:')
  const pid = isLocalAgent ? Number(agentId.slice(6)) : 0
  const isUuidAgent = !isLocalAgent && agentId.length > 10 // Simple UUID check

  return (
    <div className="terminal-agent-tab">
      {isLocalAgent && pid ? (
        <LocalAgentLogViewer pid={pid} />
      ) : isUuidAgent ? (
        <AgentLogViewer agentId={agentId} />
      ) : agentOutput && agentOutput.length > 0 ? (
        <div style={{
          padding: tokens.space[3],
          fontFamily: tokens.font.code,
          fontSize: tokens.size.md,
          color: tokens.color.text,
          whiteSpace: 'pre-wrap',
          lineHeight: 1.5
        }}>
          {agentOutput.map((chunk, i) => (
            <div key={i} style={{
              borderBottom: `1px solid ${tokens.color.border}`,
              paddingBottom: tokens.space[2],
              marginBottom: tokens.space[2]
            }}>
              {chunk}
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          padding: tokens.space[4],
          color: tokens.color.textDim,
          fontFamily: tokens.font.ui,
          fontSize: tokens.size.md,
          textAlign: 'center',
          marginTop: tokens.space[8]
        }}>
          Waiting for agent exec output…
        </div>
      )}
    </div>
  )
}
