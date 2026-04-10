/**
 * AgentCard — compact card showing agent status, task, model, and cost.
 * Used in the AgentList sidebar.
 */
import { useState, useEffect } from 'react'
import { Bot, Cpu, Clock, X, CheckCircle, XCircle, Loader, Ban } from 'lucide-react'
import './AgentCard.css'
import type { AgentMeta } from '../../../../shared/types'
import { tokens } from '../../design-system/tokens'
import { NeonCard } from '../neon/NeonCard'
import { type NeonAccent, neonVar } from '../neon/types'
import { toast } from '../../stores/toasts'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'
import { formatDuration } from '../../lib/format'

interface AgentCardProps {
  agent: AgentMeta
  selected: boolean
  onClick: () => void
  onKill?: () => void
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
            borderRadius: tokens.radius.full,
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
  const SourceIcon = agent.source === 'bde' ? Bot : Cpu
  const { confirm, confirmProps } = useConfirm()

  // Live duration ticker for running agents
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [isRunning])

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
      await window.api.killAgent(killId)
      toast.success('Agent stopped')
      // Give the backend a moment to update DB status, then refresh the list
      setTimeout(() => onKill?.(), 500)
    } catch (err) {
      toast.error(`Failed to stop agent: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  return (
    <>
      <button onClick={onClick} className="agent-card__button-reset">
        <NeonCard
          accent={accent}
          style={{
            padding: tokens.space[2],
            boxShadow: selected ? `0 0 16px ${neonVar(accent, 'glow')}` : undefined,
            border: selected ? `1px solid ${neonVar(accent, 'color')}` : undefined,
            transform: selected ? 'scale(1.02)' : undefined
          }}
        >
          <div className="agent-card__content">
            {/* Top row: status icon + task title + kill button */}
            <div className="agent-card__top-row">
              <StatusIndicator status={agent.status} accent={accent} />
              <span className="agent-card__task-title">
                {agent.task.slice(0, 80)}
              </span>
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
            </div>
            {/* Bottom row: meta info */}
            <div className="agent-card__meta-row">
              <SourceIcon size={10} className="agent-card__meta-icon" />
              <span className="agent-card__meta-text">{agent.model}</span>
              <span className="agent-card__meta-separator">·</span>
              <Clock size={10} color={neonVar(accent, 'color')} />
              <span style={{ fontSize: tokens.size.xs, color: neonVar(accent, 'color') }}>
                {formatDuration(agent.startedAt, agent.finishedAt)}
              </span>
              {/* Status label for terminal statuses */}
              {(agent.status === 'done' ||
                agent.status === 'failed' ||
                agent.status === 'cancelled') && (
                <>
                  <span className="agent-card__meta-separator">·</span>
                  <span
                    className="agent-card__status-label"
                    style={{
                      color: neonVar(accent, 'color')
                    }}
                  >
                    {agent.status === 'done'
                      ? 'Done'
                      : agent.status === 'failed'
                        ? 'Failed'
                        : 'Cancelled'}
                  </span>
                </>
              )}
              <span className="agent-card__meta-separator">·</span>
              <span className="agent-card__meta-text">{agent.repo}</span>
            </div>
          </div>
        </NeonCard>
      </button>
      <ConfirmModal {...confirmProps} />
    </>
  )
}
