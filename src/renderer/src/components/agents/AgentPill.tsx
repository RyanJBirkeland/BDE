import type { AgentMeta } from '../../../../shared/types'
import type { NeonAccent } from '../neon/types'
import { neonVar } from '../neon/types'

interface AgentPillProps {
  agent: AgentMeta
  currentAction: string
  accent: NeonAccent
  onClick: () => void
}

export function AgentPill({ agent, currentAction, accent, onClick }: AgentPillProps) {
  const truncate = (str: string, maxLen: number): string => {
    return str.length > maxLen ? str.slice(0, maxLen) + '…' : str
  }

  const dotStyle = {
    background: neonVar(accent, 'color'),
    boxShadow: neonVar(accent, 'glow')
  }

  const pillStyle = {
    borderColor: neonVar(accent, 'border'),
    background: neonVar(accent, 'surface')
  }

  const fullLabel = currentAction ? `${agent.task} — ${currentAction}` : agent.task

  return (
    <div
      className={`agent-pill ${agent.status === 'running' ? 'agent-pill--running' : ''}`}
      style={pillStyle}
      onClick={onClick}
      role="button"
      tabIndex={0}
      title={fullLabel}
      aria-label={fullLabel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick()
        }
      }}
    >
      <div className="agent-pill__dot" style={dotStyle} />
      <span className="agent-pill__name">{truncate(agent.task, 20)}</span>
      {currentAction && (
        <>
          <span style={{ color: 'var(--neon-text-dim)' }}>·</span>
          <span className="agent-pill__action">{truncate(currentAction, 30)}</span>
        </>
      )}
    </div>
  )
}
