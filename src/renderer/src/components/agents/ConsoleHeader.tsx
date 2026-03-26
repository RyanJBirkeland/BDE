/**
 * ConsoleHeader — 32px glass header for AgentConsole with status, model, duration, cost, and actions.
 */
import { useEffect, useState } from 'react'
import { Terminal, StopCircle, Copy } from 'lucide-react'
import type { AgentMeta, AgentEvent } from '../../../../shared/types'
import { NeonBadge, type NeonAccent } from '../neon'
import { useTerminalStore } from '../../stores/terminal'

interface ConsoleHeaderProps {
  agent: AgentMeta
  events: AgentEvent[]
}

function getModelAccent(model: string): NeonAccent {
  const lower = model.toLowerCase()
  if (lower.includes('opus')) return 'purple'
  if (lower.includes('sonnet')) return 'cyan'
  if (lower.includes('haiku')) return 'pink'
  return 'blue'
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
  const completedEvent = events.find(
    (e): e is Extract<AgentEvent, { type: 'agent:completed' }> => e.type === 'agent:completed'
  )
  const costUsd = completedEvent?.costUsd ?? agent.costUsd

  const handleOpenShell = () => {
    useTerminalStore.getState().addTab(undefined, agent.repoPath)
  }

  const handleStop = async () => {
    try {
      await window.api.killAgent(agent.id)
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

  // Status dot class based on agent status
  const statusDotClass = `console-header__status-dot console-header__status-dot--${agent.status}`

  return (
    <div className="console-header">
      {/* Status dot */}
      <div className={statusDotClass} />

      {/* Task name */}
      <div
        className="console-header__task-name"
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
        title={agent.task}
      >
        {agent.task}
      </div>

      {/* Model badge */}
      <NeonBadge accent={getModelAccent(agent.model)} label={agent.model} pulse={isRunning} />

      {/* Meta info */}
      <div className="console-header__meta">
        <span>{duration}</span>
        {costUsd != null && <span>${costUsd.toFixed(4)}</span>}
      </div>

      {/* Action buttons */}
      <div className="console-header__actions">
        <button
          className="console-header__action-btn"
          onClick={handleOpenShell}
          title="Open terminal in agent directory"
          aria-label="Open terminal"
        >
          <Terminal size={14} />
        </button>

        {isRunning && (
          <button
            className="console-header__action-btn"
            onClick={handleStop}
            title="Stop agent"
            aria-label="Stop agent"
          >
            <StopCircle size={14} />
          </button>
        )}

        <button
          className="console-header__action-btn"
          onClick={handleCopyLog}
          title="Copy full log to clipboard"
          aria-label="Copy log"
        >
          <Copy size={14} />
        </button>
      </div>
    </div>
  )
}
