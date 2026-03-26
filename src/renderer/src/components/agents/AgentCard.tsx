/**
 * AgentCard — compact card showing agent status, task, model, and cost.
 * Used in the AgentList sidebar.
 */
import { useState, useEffect } from 'react'
import { Bot, Cpu, Clock } from 'lucide-react'
import type { AgentMeta } from '../../../../shared/types'
import { tokens } from '../../design-system/tokens'
import { NeonCard } from '../neon/NeonCard'
import { type NeonAccent, neonVar } from '../neon/types'

interface AgentCardProps {
  agent: AgentMeta
  selected: boolean
  onClick: () => void
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

export function AgentCard({ agent, selected, onClick }: AgentCardProps) {
  const accent = STATUS_ACCENTS[agent.status] ?? 'purple'
  const isRunning = agent.status === 'running'
  const SourceIcon = agent.source === 'bde' ? Bot : Cpu

  // Live duration ticker for running agents
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  return (
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
          {/* Top row: status dot + task title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2] }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: tokens.radius.full,
                background: neonVar(accent, 'color'),
                boxShadow: `0 0 8px ${neonVar(accent, 'glow')}`,
                flexShrink: 0,
                animation: isRunning ? 'pulse 2s infinite' : undefined
              }}
            />
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
            <span style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted }}>·</span>
            <span style={{ fontSize: tokens.size.xs, color: tokens.color.textMuted }}>
              {agent.repo}
            </span>
          </div>
        </div>
      </NeonCard>
    </button>
  )
}
