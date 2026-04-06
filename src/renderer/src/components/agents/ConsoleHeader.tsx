/**
 * ConsoleHeader — 32px glass header for AgentConsole with status, model, duration, cost, and actions.
 */
import { useEffect, useState } from 'react'
import { Terminal, StopCircle, Copy } from 'lucide-react'
import type { AgentMeta, AgentEvent } from '../../../../shared/types'
import { NeonBadge, type NeonAccent } from '../neon'
import { useTerminalStore } from '../../stores/terminal'
import { toast } from '../../stores/toasts'
import { formatDuration, formatElapsed } from '../../lib/format'
import { derivePhaseLabel } from '../../lib/agent-phase'

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

function estimateCost(events: AgentEvent[], model: string): number {
  const perEventCost = model.toLowerCase().includes('opus') ? 0.003 : 0.001
  return events.length * perEventCost
}

export function ConsoleHeader({ agent, events }: ConsoleHeaderProps): React.JSX.Element {
  const isRunning = agent.status === 'running'
  const getDuration = (): string => {
    if (agent.finishedAt) {
      return formatDuration(agent.startedAt, agent.finishedAt)
    }
    return formatElapsed(new Date(agent.startedAt).getTime())
  }
  const [duration, setDuration] = useState(() => getDuration())

  // Live duration ticker for running agents
  useEffect(() => {
    if (!isRunning) return
    const interval = setInterval(() => {
      setDuration(
        agent.finishedAt
          ? formatDuration(agent.startedAt, agent.finishedAt)
          : formatElapsed(new Date(agent.startedAt).getTime())
      )
    }, 1000)
    return () => clearInterval(interval)
  }, [isRunning, agent.startedAt, agent.finishedAt])

  // Extract cost from completed event or agent meta
  const completedEvent = events.find(
    (e): e is Extract<AgentEvent, { type: 'agent:completed' }> => e.type === 'agent:completed'
  )
  const costUsd = completedEvent?.costUsd ?? agent.costUsd

  // Estimate cost for running agents with no final cost yet (only if there are events)
  const estimatedCost =
    isRunning && costUsd == null && events.length > 0 ? estimateCost(events, agent.model) : null

  const handleOpenShell = (): void => {
    useTerminalStore.getState().addTab(undefined, agent.repoPath)
  }

  const handleStop = async (): Promise<void> => {
    try {
      // Pipeline agents are keyed by sprintTaskId in AgentManager, adhoc agents by id
      const killId = agent.sprintTaskId ?? agent.id
      await window.api.killAgent(killId)
    } catch (err) {
      toast.error(`Failed to stop agent: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const handleCopyLog = async (): Promise<void> => {
    try {
      const result = await window.api.tailAgentLog({ logPath: agent.logPath, fromByte: 0 })
      await navigator.clipboard.writeText(result.content)
      toast.success('Log copied to clipboard')
    } catch (err) {
      toast.error(`Failed to copy log: ${err instanceof Error ? err.message : 'Unknown error'}`)
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
        {isRunning && (
          <span
            className="console-header__phase"
            data-testid="console-header-phase"
            aria-label={`Agent phase: ${derivePhaseLabel(events)}`}
            style={{ opacity: 0.8 }}
          >
            {derivePhaseLabel(events)}
          </span>
        )}
        {costUsd != null && <span>${costUsd.toFixed(4)}</span>}
        {estimatedCost != null && (
          <span
            style={{ color: 'var(--neon-orange)', fontStyle: 'italic' }}
            title="Estimated based on event count"
          >
            ~${estimatedCost.toFixed(2)}
          </span>
        )}
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
