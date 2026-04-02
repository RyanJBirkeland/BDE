/**
 * AgentCard — compact card showing agent status, task, model, and cost.
 * Used in the AgentList sidebar.
 */
import { useState, useEffect } from 'react'
import { Bot, Cpu, Clock, X, CheckCircle, XCircle, Loader, Ban } from 'lucide-react'
import type { AgentMeta } from '../../../../shared/types'
import { tokens } from '../../design-system/tokens'
import { NeonCard } from '../neon/NeonCard'
import { type NeonAccent, neonVar } from '../neon/types'
import { toast } from '../../stores/toasts'
import { useConfirm, ConfirmModal } from '../ui/ConfirmModal'

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

function formatDuration(startedAt: string, finishedAt: string | null): string {
  const start = new Date(startedAt).getTime()
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now()
  const sec = Math.floor((end - start) / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

interface StatusIndicatorProps {
  status: string
  accent: NeonAccent
}

function StatusIndicator({ status, accent }: StatusIndicatorProps) {
  const iconColor = neonVar(accent, 'color')
  const iconSize = 14

  switch (status) {
    case 'running':
      return <Loader size={iconSize} className="agent-card__status-spinner" aria-label="Running" style={{ color: iconColor }} />
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
            boxShadow: `0 0 8px ${neonVar(accent, 'glow')}`,
            flexShrink: 0
          }}
        />
      )
  }
}

export function AgentCard({ agent, selected, onClick, onKill }: AgentCardProps) {
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

  const handleKill = async (e: React.MouseEvent) => {
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
    <button
      onClick={onClick}
      style={{
        all: 'unset',
        display: 'block',
        width: '100%',
        padding: `${tokens.space[2]} ${tokens.space[3]}`,
        cursor: 'pointer',
        boxSizing: 'border-box'
      }}
    >
      <NeonCard
        accent={accent}
        style={{
          padding: tokens.space[2],
          boxShadow: selected
            ? `0 0 16px ${neonVar(accent, 'glow')}, var(--neon-glass-shadow), var(--neon-glass-edge)`
            : undefined,
          border: selected ? `1px solid ${neonVar(accent, 'color')}` : undefined,
          transform: selected ? 'scale(1.02)' : undefined
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
          {/* Top row: status icon + task title + kill button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2] }}>
            <StatusIndicator status={agent.status} accent={accent} />
            <span
              style={{
                fontSize: tokens.size.md,
                color: tokens.color.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1
              }}
            >
              {agent.task.slice(0, 80)}
            </span>
            {isRunning && (
              <button
                onClick={handleKill}
                title="Stop agent"
                aria-label="Stop agent"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  padding: 0,
                  background: 'var(--neon-surface-deep, rgba(10,0,21,0.4))',
                  border: `1px solid ${neonVar('red', 'border')}`,
                  borderRadius: tokens.radius.sm,
                  cursor: 'pointer',
                  color: neonVar('red', 'color'),
                  flexShrink: 0,
                  transition: tokens.transition.fast
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = neonVar('red', 'surface')
                  e.currentTarget.style.boxShadow = `0 0 8px ${neonVar('red', 'glow')}`
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--neon-surface-deep, rgba(10,0,21,0.4))'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
          {/* Bottom row: meta info */}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2], paddingLeft: 14 }}
          >
            <SourceIcon size={10} color={tokens.color.textDim} />
            <span style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted }}>
              {agent.model}
            </span>
            <span style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted }}>·</span>
            <Clock size={10} color={neonVar(accent, 'color')} />
            <span style={{ fontSize: tokens.size.xs, color: neonVar(accent, 'color') }}>
              {formatDuration(agent.startedAt, agent.finishedAt)}
            </span>
            {/* Status label for terminal statuses */}
            {(agent.status === 'done' || agent.status === 'failed' || agent.status === 'cancelled') && (
              <>
                <span style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted }}>·</span>
                <span style={{ fontSize: tokens.size.xs, color: neonVar(accent, 'color'), fontWeight: 700 }}>
                  {agent.status === 'done' ? 'Done' : agent.status === 'failed' ? 'Failed' : 'Cancelled'}
                </span>
              </>
            )}
            <span style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted }}>·</span>
            <span style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted }}>
              {agent.repo}
            </span>
          </div>
        </div>
      </NeonCard>
    </button>
    <ConfirmModal {...confirmProps} />
    </>
  )
}
