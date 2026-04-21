/**
 * AgentCard — compact card showing agent status, task, model, and cost.
 * Used in the AgentList sidebar.
 */
import { useState } from 'react'
import { Clock, DollarSign, X, CheckCircle, XCircle, Loader, Ban } from 'lucide-react'
import './AgentCard.css'
import type { AgentMeta } from '../../../../shared/types'
import { NeonCard } from '../neon/NeonCard'
import { type NeonAccent, neonVar } from '../neon/types'
import { toast } from '../../stores/toasts'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import { formatDuration } from '../../lib/format'
import { useBackoffInterval } from '../../hooks/useBackoffInterval'

interface AgentCardProps {
  agent: AgentMeta
  selected: boolean
  onClick: () => void
  onKill?: (() => void) | undefined
}

const STATUS_ACCENTS: Record<string, NeonAccent> = {
  running: 'cyan',
  done: 'purple',
  failed: 'red',
  cancelled: 'orange',
  unknown: 'purple'
}

interface StatusIndicatorProps {
  status: string
  accent: NeonAccent
}

function StatusIndicator({ status, accent }: StatusIndicatorProps): React.JSX.Element {
  const iconColor = neonVar(accent, 'color')
  const iconSize = 14

  switch (status) {
    case 'running':
      return (
        <Loader
          size={iconSize}
          className="agent-card__status-spinner"
          aria-label="Running"
          style={{ color: iconColor }}
        />
      )
    case 'done':
      return <CheckCircle size={iconSize} aria-label="Done" style={{ color: iconColor }} />
    case 'failed':
      return <XCircle size={iconSize} aria-label="Failed" style={{ color: iconColor }} />
    case 'cancelled':
      return <Ban size={iconSize} aria-label="Cancelled" style={{ color: iconColor }} />
    default:
      // Fallback: colored dot
      return (
        <span
          aria-label={status}
          style={{
            width: 6,
            height: 6,
            borderRadius: 'var(--bde-radius-full)',
            background: iconColor,
            flexShrink: 0
          }}
        />
      )
  }
}

export function AgentCard({ agent, selected, onClick, onKill }: AgentCardProps): React.JSX.Element {
  const accent = STATUS_ACCENTS[agent.status] ?? 'purple'
  const isRunning = agent.status === 'running'
  const { confirm, confirmProps } = useConfirm()

  // Live duration ticker for running agents — pauses when tab is hidden, no battery drain.
  const [, setTick] = useState(0)
  useBackoffInterval(() => setTick((t) => t + 1), isRunning ? 1000 : null)

  const handleKill = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    const label = agent.task.length > 40 ? agent.task.slice(0, 40) + '\u2026' : agent.task
    const ok = await confirm({
      title: 'Stop Agent',
      message: `Stop "${label}"? Any uncommitted work will be lost.`,
      confirmLabel: 'Stop',
      variant: 'danger'
    })
    if (!ok) return
    try {
      // Pipeline agents are keyed by sprintTaskId in AgentManager, adhoc agents by id
      const killId = agent.sprintTaskId ?? agent.id
      await window.api.agents.kill(killId)
      toast.success('Agent stopped')
      // Give the backend a moment to update DB status, then refresh the list
      setTimeout(() => onKill?.(), 500)
    } catch (err) {
      toast.error(`Failed to stop agent: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const taskTitleTruncated = agent.task.length > 80 ? agent.task.slice(0, 80) + '…' : agent.task
  const costFormatted = agent.costUsd != null ? `$${agent.costUsd.toFixed(2)}` : '$0.00'

  return (
    <>
      <button
        onClick={onClick}
        className="agent-card__button-reset"
        data-accent={accent}
        data-selected={selected}
      >
        <NeonCard
          accent={accent}
          className="agent-card__card"
          style={{
            padding: 'var(--bde-space-3)',
            boxShadow: selected ? `0 0 16px ${neonVar(accent, 'glow')}` : undefined,
            border: selected ? `1px solid ${neonVar(accent, 'color')}` : undefined,
            transform: selected ? 'scale(1.02)' : undefined
          }}
        >
          <div className="agent-card__content">
            {/* Row 1: Title row with status icon, task title, kill button, model badge */}
            <div className="agent-card__title-row">
              <StatusIndicator status={agent.status} accent={accent} />
              <span className="agent-card__task-title">{taskTitleTruncated}</span>
              {isRunning && (
                <button
                  className="agent-card__kill-btn"
                  onClick={handleKill}
                  title="Stop agent"
                  aria-label="Stop agent"
                >
                  <X size={12} />
                </button>
              )}
              <span className="agent-card__model-badge">{agent.model}</span>
            </div>

            {/* Row 2: Status row (conditional based on agent status) */}
            {agent.status === 'done' && (
              <div className="agent-card__status-row">
                Completed in {formatDuration(agent.startedAt, agent.finishedAt)}
              </div>
            )}
            {agent.status === 'failed' && (
              <div className="agent-card__status-row agent-card__status-row--error">Failed</div>
            )}
            {agent.status === 'cancelled' && (
              <div className="agent-card__status-row agent-card__status-row--cancelled">
                Cancelled
              </div>
            )}

            {/* Row 3: Meta strip with icons */}
            <div className="agent-card__meta-strip">
              <Clock size={12} className="agent-card__meta-icon" />
              <span className="agent-card__meta-text">
                {formatDuration(agent.startedAt, agent.finishedAt)}
              </span>
              <span className="agent-card__meta-separator">•</span>
              <DollarSign size={12} className="agent-card__meta-icon" />
              <span className="agent-card__meta-text">{costFormatted}</span>
              <span className="agent-card__meta-separator">•</span>
              <span className="agent-card__meta-text">{agent.repo}</span>
            </div>
          </div>
        </NeonCard>
      </button>
      <ConfirmModal {...confirmProps} />
    </>
  )
}
