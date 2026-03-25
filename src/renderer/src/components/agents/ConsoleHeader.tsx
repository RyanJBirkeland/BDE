/**
 * ConsoleHeader — 32px glass header for AgentConsole with status, model, duration, cost, and actions.
 */
import { useEffect, useState } from 'react'
import { Terminal, Square, Copy } from 'lucide-react'
import type { AgentMeta, AgentEvent } from '../../../../shared/types'
import { tokens } from '../../design-system/tokens'
import { NeonBadge } from '../neon'
import { useTerminalStore } from '../../stores/terminal'

interface ConsoleHeaderProps {
  agent: AgentMeta
  events: AgentEvent[]
}

function formatDuration(startedAt: string, finishedAt: string | null): string {
  const start = new Date(startedAt).getTime()
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now()
  const durationMs = end - start
  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

const headerStyle: React.CSSProperties = {
  height: '32px',
  display: 'flex',
  alignItems: 'center',
  gap: tokens.space[2],
  padding: `0 ${tokens.space[3]}`,
  background: 'var(--glass-tint-dark)',
  backdropFilter: 'var(--glass-blur) var(--glass-saturate)',
  borderBottom: `1px solid ${tokens.color.border}`,
  fontSize: tokens.size.sm,
  flexShrink: 0,
}

const statusDotStyle = (isRunning: boolean): React.CSSProperties => ({
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  background: isRunning ? tokens.color.success : tokens.color.textMuted,
  flexShrink: 0,
  animation: isRunning ? 'pulse 2s ease-in-out infinite' : undefined,
})

const taskNameStyle: React.CSSProperties = {
  fontWeight: 600,
  color: tokens.color.text,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
}

const metaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: tokens.space[3],
  fontSize: tokens.size.xs,
  color: tokens.color.textMuted,
  flexShrink: 0,
}

const buttonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: tokens.space[1],
  display: 'flex',
  alignItems: 'center',
  color: tokens.color.textMuted,
  borderRadius: tokens.radius.sm,
  transition: tokens.transition.fast,
}

export function ConsoleHeader({ agent, events }: ConsoleHeaderProps) {
  const isRunning = agent.status === 'running'
  const [duration, setDuration] = useState(formatDuration(agent.startedAt, agent.finishedAt))

  // Live duration ticker for running agents
  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(() => {
      setDuration(formatDuration(agent.startedAt, agent.finishedAt))
    }, 1000)
    return () => clearInterval(interval)
  }, [isRunning, agent.startedAt, agent.finishedAt])

  // Extract cost from completed event or agent meta
  const completedEvent = events.find((e): e is Extract<AgentEvent, { type: 'agent:completed' }> =>
    e.type === 'agent:completed'
  )
  const costUsd = completedEvent?.costUsd ?? agent.costUsd

  const handleOpenShell = () => {
    useTerminalStore.getState().addTab(undefined, agent.repoPath)
  }

  const handleStop = async () => {
    try {
      await window.api.agents.stop({ id: agent.id })
    } catch (err) {
      console.error('Failed to stop agent:', err)
    }
  }

  const handleCopyLog = async () => {
    try {
      const result = await window.api.tailAgentLog({ logPath: agent.logPath, fromByte: 0 })
      await navigator.clipboard.writeText(result.content)
    } catch (err) {
      console.error('Failed to copy log:', err)
    }
  }

  return (
    <div style={headerStyle} className="console-header">
      <div style={statusDotStyle(isRunning)} />
      <span style={taskNameStyle}>{agent.task}</span>
      <div style={metaStyle}>
        <NeonBadge accent="cyan" label={agent.model} />
        <span>{duration}</span>
        {costUsd != null && <span>${costUsd.toFixed(4)}</span>}
      </div>
      <button
        onClick={handleOpenShell}
        style={buttonStyle}
        title="Open shell in agent directory"
        aria-label="Open shell in agent directory"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = tokens.color.surfaceHigh
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'none'
        }}
      >
        <Terminal size={14} />
      </button>
      {isRunning && (
        <button
          onClick={handleStop}
          style={buttonStyle}
          title="Stop agent"
          aria-label="Stop agent"
          onMouseEnter={(e) => {
            e.currentTarget.style.background = tokens.color.surfaceHigh
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'none'
          }}
        >
          <Square size={14} />
        </button>
      )}
      <button
        onClick={handleCopyLog}
        style={buttonStyle}
        title="Copy log to clipboard"
        aria-label="Copy log to clipboard"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = tokens.color.surfaceHigh
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'none'
        }}
      >
        <Copy size={14} />
      </button>
    </div>
  )
}
