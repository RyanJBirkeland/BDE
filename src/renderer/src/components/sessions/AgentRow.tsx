import { useCallback, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Badge } from '../ui/Badge'
import type { UnifiedAgent } from '../../hooks/useUnifiedAgents'
import { getStaleLevel } from '../../hooks/useUnifiedAgents'
import { timeAgo, modelBadgeLabel } from '../../lib/format'
import { TRANSITIONS, useReducedMotion } from '../../lib/motion'
import { useTerminalStore } from '../../stores/terminal'

export interface AgentRowProps {
  agent: UnifiedAgent
  isSelected: boolean
  onSelect: () => void
  onKill: () => void
  onSteer: () => void
}

const FIVE_MINUTES = 5 * 60 * 1000

function dotClass(agent: UnifiedAgent): string {
  if (agent.isBlocked) return 'agent-row__dot dot--blocked'
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
  const reduced = useReducedMotion()
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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      // Only show context menu for agents with sessionKey (gateway sessions/sub-agents)
      if (!agent.sessionKey) return

      const menu = document.createElement('div')
      menu.className = 'agent-row-context-menu'
      menu.style.position = 'fixed'
      menu.style.left = `${e.clientX}px`
      menu.style.top = `${e.clientY}px`
      menu.style.zIndex = '10000'

      const watchOption = document.createElement('button')
      watchOption.className = 'agent-row-context-menu__item'
      watchOption.textContent = '↗ Watch in Terminal'
      watchOption.onclick = () => {
        const createAgentTab = useTerminalStore.getState().createAgentTab
        createAgentTab(agent.id, agent.label, agent.sessionKey!)
        document.body.removeChild(menu)
      }

      menu.appendChild(watchOption)
      document.body.appendChild(menu)

      const closeMenu = (): void => {
        if (document.body.contains(menu)) {
          document.body.removeChild(menu)
        }
        document.removeEventListener('click', closeMenu)
      }

      setTimeout(() => document.addEventListener('click', closeMenu), 0)
    },
    [agent.id, agent.label, agent.sessionKey]
  )

  const isRunning = agent.status === 'running'

  return (
    <motion.button
      whileHover={reduced ? undefined : { scale: 1.008, transition: TRANSITIONS.instant }}
      whileTap={reduced ? undefined : { scale: 0.998 }}
      className={[
        'agent-row glass glass-highlight',
        isSelected && 'agent-row--selected gradient-border glow-accent-sm',
        isRunning && !isSelected && 'glow-pulse',
      ].filter(Boolean).join(' ')}
      onClick={onSelect}
      onContextMenu={handleContextMenu}
    >
      <span className={dotClass(agent)} title={agent.isBlocked ? 'Session aborted — may need attention' : undefined} />
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
    </motion.button>
  )
}
