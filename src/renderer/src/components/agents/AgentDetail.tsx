/**
 * AgentDetail — right panel showing agent header, chat renderer, and steer input.
 */
import { useMemo, useState, useEffect } from 'react'
import { Bot, Clock, Zap, DollarSign, Terminal } from 'lucide-react'
import type { AgentMeta } from '../../../../shared/types'
import type { AgentEvent } from '../../../../shared/types'
import { tokens } from '../../design-system/tokens'
import { ChatRenderer } from './ChatRenderer'
import { SteerInput } from './SteerInput'
import { useTerminalStore } from '../../stores/terminal'

interface AgentDetailProps {
  agent: AgentMeta
  events: AgentEvent[]
  onSteer: (message: string) => void
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  running: { label: 'Running', color: tokens.color.success },
  done: { label: 'Done', color: tokens.color.textMuted },
  failed: { label: 'Failed', color: tokens.color.danger },
  cancelled: { label: 'Cancelled', color: tokens.color.warning },
  unknown: { label: 'Unknown', color: tokens.color.textDim }
}

export function AgentDetail({ agent, events, onSteer }: AgentDetailProps) {
  const status = STATUS_LABELS[agent.status] ?? STATUS_LABELS.unknown
  const isRunning = agent.status === 'running'

  const costInfo = useMemo(() => {
    const completed = events.find(
      (e): e is Extract<AgentEvent, { type: 'agent:completed' }> => e.type === 'agent:completed'
    )
    return completed
      ? {
          cost: completed.costUsd,
          tokens: completed.tokensIn + completed.tokensOut,
          duration: completed.durationMs
        }
      : null
  }, [events])

  const handleOpenShell = () => {
    const cwd = agent.repoPath
    useTerminalStore.getState().addTab(undefined, cwd)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          padding: `${tokens.space[3]} ${tokens.space[4]}`,
          borderBottom: `1px solid ${tokens.color.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[1]
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2] }}>
          <Bot size={16} color={tokens.color.textMuted} />
          <span
            style={{
              fontSize: tokens.size.lg,
              color: tokens.color.text,
              fontWeight: 500,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {agent.task.slice(0, 120)}
          </span>
          <button
            onClick={handleOpenShell}
            aria-label="Open shell in agent directory"
            title="Open shell in agent directory"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: tokens.space[1],
              display: 'flex',
              alignItems: 'center',
              color: tokens.color.textMuted,
              borderRadius: tokens.radius.md
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = tokens.color.surfaceHigh
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'none'
            }}
          >
            <Terminal size={16} />
          </button>
          <span
            style={{
              fontSize: tokens.size.xs,
              padding: `2px ${tokens.space[2]}`,
              borderRadius: tokens.radius.full,
              background: status.color + '22',
              color: status.color
            }}
          >
            {status.label}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[3],
            fontSize: tokens.size.xs,
            color: tokens.color.textMuted
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: tokens.space[1] }}>
            <Zap size={10} /> {agent.model}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: tokens.space[1] }}>
            <Clock size={10} /> {new Date(agent.startedAt).toLocaleTimeString()}
          </span>
          {costInfo && (
            <span style={{ display: 'flex', alignItems: 'center', gap: tokens.space[1] }}>
              <DollarSign size={10} /> ${costInfo.cost.toFixed(4)}
            </span>
          )}
          <span>{agent.repo}</span>
        </div>
      </div>

      {/* Chat body */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {events.length > 0 ? (
          <ChatRenderer events={events} />
        ) : (
          <LogFallback logPath={agent.logPath} />
        )}
      </div>

      {/* Steer input — only when running */}

      {isRunning && (
        <div style={{ borderTop: `1px solid ${tokens.color.border}`, padding: tokens.space[3] }}>
          <SteerInput agentId={agent.id} onSend={onSteer} />
        </div>
      )}
    </div>
  )
}

/** Fallback for pre-Phase-2 agents that have log files but no AgentEvent records. */
function LogFallback({ logPath }: { logPath: string }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.api
      .tailAgentLog({ logPath, fromByte: 0 })
      .then((result) => {
        if (!cancelled) {
          setContent(result.content)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [logPath])

  if (loading) {
    return (
      <div style={{ padding: tokens.space[4], color: tokens.color.textDim, textAlign: 'center' }}>
        Loading log...
      </div>
    )
  }

  if (!content) {
    return (
      <div style={{ padding: tokens.space[4], color: tokens.color.textDim, textAlign: 'center' }}>
        No output available for this agent.
      </div>
    )
  }

  return (
    <pre
      style={{
        padding: tokens.space[3],
        margin: 0,
        fontFamily: tokens.font.code,
        fontSize: tokens.size.sm,
        color: tokens.color.text,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'auto',
        height: '100%'
      }}
    >
      {content}
    </pre>
  )
}
