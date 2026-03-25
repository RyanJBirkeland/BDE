/**
 * ConsoleHeader — 32px glass header for AgentConsole.
 * Shows status, task name, model badge, duration, cost, and action buttons.
 */
import { useEffect, useState, useMemo } from 'react'
import { Terminal, Square, Copy } from 'lucide-react'
import type { AgentMeta, AgentEvent } from '../../../../shared/types'
import type { NeonAccent } from '../neon/types'
import { NeonBadge } from '../neon/NeonBadge'
import { useTerminalStore } from '../../stores/terminal'

interface ConsoleHeaderProps {
  agent: AgentMeta
  events: AgentEvent[]
}

function getModelAccent(model: string): NeonAccent {
  if (model.includes('haiku')) return 'blue'
  if (model.includes('opus')) return 'orange'
  return 'purple' // sonnet default
}

function getModelLabel(model: string): string {
  if (model.includes('haiku')) return 'Haiku'
  if (model.includes('opus')) return 'Opus'
  if (model.includes('sonnet')) return 'Sonnet'
  return model
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${seconds}s`
}

export function ConsoleHeader({ agent, events }: ConsoleHeaderProps) {
  const isRunning = agent.status === 'running'
  const [liveElapsed, setLiveElapsed] = useState(0)

  // Extract cost info from completed event or agent meta
  const costInfo = useMemo(() => {
    const completed = events.find((e): e is Extract<AgentEvent, { type: 'agent:completed' }> =>
      e.type === 'agent:completed'
    )
    return completed
      ? { cost: completed.costUsd, duration: completed.durationMs }
      : { cost: agent.costUsd, duration: null }
  }, [events, agent.costUsd])

  // Live duration ticker for running agents
  useEffect(() => {
    if (!isRunning) return

    const startTime = new Date(agent.startedAt).getTime()
    const updateElapsed = () => {
      setLiveElapsed(Date.now() - startTime)
    }

    updateElapsed() // Initial
    const interval = setInterval(updateElapsed, 1000)
    return () => clearInterval(interval)
  }, [isRunning, agent.startedAt])

  const handleOpenShell = () => {
    useTerminalStore.getState().addTab(undefined, agent.repoPath)
  }

  const handleStop = async () => {
    if (agent.pid) {
      await window.api.agents.stop({ pid: agent.pid })
    }
  }

  const handleCopyLog = async () => {
    try {
      const result = await window.api.agents.readLog({ id: agent.id, fromByte: 0 })
      await navigator.clipboard.writeText(result.content)
    } catch (err) {
      console.error('Failed to copy log:', err)
    }
  }

  const statusDotClass = `console-header__status-dot console-header__status-dot--${agent.status}`

  return (
    <div className="console-header">
      <div className={statusDotClass} />
      <span className="console-header__task-name">
        {agent.task.length > 50 ? agent.task.slice(0, 50) + '...' : agent.task}
      </span>
      <NeonBadge accent={getModelAccent(agent.model)} label={getModelLabel(agent.model)} />

      <div className="console-header__meta">
        {isRunning ? (
          <span>{formatDuration(liveElapsed)}</span>
        ) : costInfo.duration !== null ? (
          <span>{formatDuration(costInfo.duration)}</span>
        ) : null}

        {costInfo.cost !== null && (
          <span>${costInfo.cost.toFixed(4)}</span>
        )}
      </div>

      <div className="console-header__actions">
        <button
          onClick={handleOpenShell}
          className="console-header__action-btn"
          title="Open shell in agent directory"
          aria-label="Open shell"
        >
          <Terminal size={14} />
        </button>

        {isRunning && (
          <button
            onClick={handleStop}
            className="console-header__action-btn"
            title="Stop agent"
            aria-label="Stop agent"
          >
            <Square size={14} />
          </button>
        )}

        <button
          onClick={handleCopyLog}
          className="console-header__action-btn"
          title="Copy full log to clipboard"
          aria-label="Copy log"
        >
          <Copy size={14} />
        </button>
      </div>
    </div>
  )
}
