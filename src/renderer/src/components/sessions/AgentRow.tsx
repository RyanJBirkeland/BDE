import { useCallback, useRef, useState } from 'react'
import { Badge } from '../ui/Badge'
import type { UnifiedAgent } from '../../stores/unifiedAgents'
import { getStaleLevel } from '../../stores/unifiedAgents'

export interface AgentRowProps {
  agent: UnifiedAgent
  isSelected: boolean
  onSelect: () => void
  onKill: () => void
  onSteer: () => void
}

const FIVE_MINUTES = 5 * 60 * 1000

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function modelBadgeLabel(model: string): string {
  if (model.includes('opus')) return 'opus'
  if (model.includes('sonnet')) return 'sonnet'
  if (model.includes('haiku')) return 'haiku'
  return model.split('-')[0] ?? model
}

function dotClass(agent: UnifiedAgent): string {
  if (agent.status === 'running') {
    const age = Date.now() - agent.updatedAt
    return age < FIVE_MINUTES ? 'agent-row__dot dot--active' : 'agent-row__dot dot--stale-running'
  }
  if (agent.status === 'failed') return 'agent-row__dot dot--failed'
  if (agent.status === 'done' || agent.status === 'timeout') return 'agent-row__dot dot--done'
  return 'agent-row__dot dot--unknown'
}

export function AgentRow({
  agent,
  isSelected,
  onSelect,
  onKill,
  onSteer
}: AgentRowProps): React.JSX.Element {
  const [killing, setKilling] = useState(false)
  const killTargetRef = useRef(false)
  const staleLevel = getStaleLevel(agent)
  const showStale = staleLevel === 'stale' || staleLevel === 'dead'
  const taskPreview = agent.task ? (agent.task.length > 60 ? agent.task.slice(0, 60) + '\u2026' : agent.task) : undefined

  const handleKillDown = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation()
    killTargetRef.current = true
  }, [])

  const handleKillUp = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation()
      if (!killTargetRef.current || killing) return
      killTargetRef.current = false
      setKilling(true)
      onKill()
      setKilling(false)
    },
    [killing, onKill]
  )

  const handleKillLeave = useCallback((): void => {
    killTargetRef.current = false
  }, [])

  const handleSteerClick = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation()
      if (!agent.canSteer) return
      onSteer()
    },
    [agent.canSteer, onSteer]
  )

  return (
    <button
      className={`agent-row ${isSelected ? 'agent-row--selected' : ''}`}
      onClick={onSelect}
    >
      <span className={dotClass(agent)} />
      <div className="agent-row__info">
        <span className="agent-row__label">{agent.label}</span>
        <span className="agent-row__meta">
          {agent.model && (
            <Badge variant="muted" size="sm">{modelBadgeLabel(agent.model)}</Badge>
          )}
          <span className={`source-badge source-badge--${agent.source}`}>
            {agent.source}
          </span>
          {showStale && (
            <span className="agent-row__stale-badge">STALE</span>
          )}
          <span className="agent-row__time">{timeAgo(agent.updatedAt)}</span>
        </span>
        {taskPreview && (
          <span className="agent-row__task">{taskPreview}</span>
        )}
      </div>
      <span
        className={`agent-row__action agent-row__action--steer ${!agent.canSteer ? 'agent-row__action--disabled' : ''}`}
        role="button"
        tabIndex={-1}
        onClick={handleSteerClick}
        title={agent.canSteer ? 'Steer agent' : 'Read-only \u2014 cannot steer this agent'}
      >
        {'\u270E'}
      </span>
      {agent.canKill && (
        <span
          className="agent-row__action agent-row__action--kill"
          role="button"
          tabIndex={-1}
          onMouseDown={handleKillDown}
          onMouseUp={handleKillUp}
          onMouseLeave={handleKillLeave}
          title="Stop agent"
        >
          {killing ? '...' : '\u00d7'}
        </span>
      )}
    </button>
  )
}
