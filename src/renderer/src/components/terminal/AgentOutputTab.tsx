import { useEffect, useState, useMemo } from 'react'
import { LocalAgentLogViewer, AgentLogViewer } from '../sessions/LocalAgentLogViewer'
import { tokens } from '../../design-system/tokens'
import { parseStreamJson } from '../../lib/stream-parser'
import { chatItemsToMessages } from '../../lib/agent-messages'
import { ChatThread } from '../sessions/ChatThread'

interface AgentOutputTabProps {
  agentId: string
  agentOutput?: string[]
  sessionKey?: string
}

export function AgentOutputTab({ agentId, agentOutput, sessionKey }: AgentOutputTabProps): React.JSX.Element {
  const [historyContent, setHistoryContent] = useState<string>('')
  const [isPolling, setIsPolling] = useState(false)

  // Poll gateway session history every 5s for gateway sessions
  useEffect(() => {
    if (!sessionKey) return

    const pollHistory = async (): Promise<void> => {
      try {
        const result = await window.api.getSessionHistory(sessionKey) as { history?: Array<{ type: string; content?: unknown; tool_use?: unknown }> }

        // Extract exec tool results and format as stream-json lines
        const execResults = (result.history ?? [])
          .filter((item) => item.type === 'tool_use' && item.tool_use && typeof item.tool_use === 'object' && 'name' in item.tool_use && item.tool_use.name === 'exec')
          .map((item) => JSON.stringify(item))
          .join('\n')

        setHistoryContent(execResults)
      } catch (err) {
        console.error('Failed to fetch session history:', err)
      }
    }

    setIsPolling(true)
    pollHistory()
    const interval = setInterval(pollHistory, 5000)

    return () => {
      clearInterval(interval)
      setIsPolling(false)
    }
  }, [sessionKey])

  // Parse stream-json for gateway sessions
  const { items, isStreaming } = useMemo(() => {
    if (!sessionKey || !historyContent) return { items: [], isStreaming: false }
    return parseStreamJson(historyContent)
  }, [sessionKey, historyContent])

  const chatMessages = useMemo(() => {
    if (!sessionKey || items.length === 0) return []
    return chatItemsToMessages(items)
  }, [sessionKey, items])

  // Parse agentId format: either "local:pid", a UUID, or a sessionKey
  const isLocalAgent = agentId.startsWith('local:')
  const pid = isLocalAgent ? Number(agentId.slice(6)) : 0
  const isUuidAgent = !isLocalAgent && agentId.length > 10 && !sessionKey // Simple UUID check

  return (
    <div className="terminal-agent-tab">
      {isLocalAgent && pid ? (
        <LocalAgentLogViewer pid={pid} />
      ) : isUuidAgent ? (
        <AgentLogViewer agentId={agentId} />
      ) : sessionKey ? (
        chatMessages.length > 0 ? (
          <ChatThread messages={chatMessages} isStreaming={isPolling && isStreaming} />
        ) : (
          <div style={{
            padding: tokens.space[4],
            color: tokens.color.textDim,
            fontFamily: tokens.font.ui,
            fontSize: tokens.size.md,
            textAlign: 'center',
            marginTop: tokens.space[8]
          }}>
            {isPolling ? 'Waiting for agent exec output…' : 'Loading session history…'}
          </div>
        )
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
