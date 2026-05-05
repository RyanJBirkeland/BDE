/**
 * FleetGlance — V2 tile grid overview shown when no agent is selected.
 *
 * Layout: header (eyebrow + title + Spawn button) → live tile grid → fleet metrics row.
 * Pulse rule (§5.3): each running tile carries `.fleet-pulse`; non-running tiles use
 * `.fleet-dot--{status}`. No pulse anywhere else in this component.
 */
import { useMemo } from 'react'
import type { AgentMeta } from '../../../../shared/types'
import { formatDuration, formatElapsed, timeAgo } from '../../lib/format'
import { MiniStat } from '../sprint/primitives/MiniStat'
import { useSprintTasks, selectReviewTaskCount } from '../../stores/sprintTasks'
import './FleetGlance.css'

interface FleetGlanceProps {
  agents: AgentMeta[]
  onSelect: (id: string) => void
  onSpawn: () => void
}

interface AgentTileProps {
  agent: AgentMeta
  onClick: () => void
}

function AgentTile({ agent, onClick }: AgentTileProps): React.JSX.Element {
  const isRunning = agent.status === 'running'
  const elapsed = isRunning
    ? formatElapsed(new Date(agent.startedAt).getTime())
    : formatDuration(agent.startedAt, agent.finishedAt)

  return (
    <button
      onClick={onClick}
      style={{
        padding: 'var(--s-3)',
        background: 'var(--surf-1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-lg)',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-2)',
        width: '100%',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = 'var(--surf-2)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = 'var(--surf-1)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-1)' }}>
        {isRunning ? (
          <span className="fleet-pulse" style={{ width: 6, height: 6, flexShrink: 0 }} aria-label="Running" />
        ) : (
          <span className={`fleet-dot--${agent.status}`} style={{ width: 6, height: 6, flexShrink: 0 }} />
        )}
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--fg)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {agent.id}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-4)', flexShrink: 0 }}>
          {timeAgo(agent.startedAt)}
        </span>
      </div>

      <div
        style={{
          fontSize: 12,
          color: 'var(--fg-2)',
          lineHeight: 1.4,
          minHeight: 32,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {agent.task}
      </div>

      {isRunning && (
        <div style={{ height: 2, background: 'var(--surf-3)', borderRadius: 999 }}>
          {/* TODO(verify): replace with event-based progress pct once AgentMeta exposes it */}
          <div style={{ height: '100%', width: '100%', background: 'var(--st-running)', opacity: 0.6 }} />
        </div>
      )}

      <div style={{ display: 'flex', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-3)' }}>
        <span style={{ flex: 1 }}>{elapsed}</span>
        <span style={{ color: 'var(--fg-4)' }}>{agent.repo}</span>
      </div>
    </button>
  )
}

export function FleetGlance({ agents, onSelect, onSpawn }: FleetGlanceProps): React.JSX.Element {
  const pendingReviewCount = useSprintTasks(selectReviewTaskCount)
  const { running, doneToday, todayCost, runningAgents, recentCompletions } = useMemo(() => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayStartMs = todayStart.getTime()

    const runningList = agents.filter((a) => a.status === 'running')
    const todayFinished = agents.filter(
      (a) => a.finishedAt && new Date(a.finishedAt).getTime() >= todayStartMs
    )

    const doneCount = todayFinished.filter((a) => a.status === 'done').length
    const totalCost = todayFinished.reduce((sum, a) => sum + (a.costUsd ?? 0), 0)

    const recent = agents
      .filter((a) => a.status === 'done' || a.status === 'failed' || a.status === 'cancelled')
      .sort((a, b) => {
        const aMs = a.finishedAt ? new Date(a.finishedAt).getTime() : 0
        const bMs = b.finishedAt ? new Date(b.finishedAt).getTime() : 0
        return bMs - aMs
      })
      .slice(0, 5)

    return {
      running: runningList.length,
      doneToday: doneCount,
      todayCost: totalCost,
      runningAgents: runningList.slice(0, 6),
      recentCompletions: recent,
    }
  }, [agents])

  const formatCost = (usd: number): string => `$${usd.toFixed(2)}`

  return (
    <div style={{ padding: 'var(--s-7) var(--s-8)', overflowY: 'auto', flex: 1 }}>
      <div
        style={{
          maxWidth: 880,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--s-6)',
        }}
      >
        <GlanceHeader onSpawn={onSpawn} />

        {runningAgents.length > 0 && (
          <TileGrid agents={runningAgents} onSelect={onSelect} />
        )}

        {runningAgents.length === 0 && recentCompletions.length > 0 && (
          <TileGrid agents={recentCompletions} onSelect={onSelect} />
        )}

        {runningAgents.length === 0 && recentCompletions.length === 0 && (
          <EmptyState onSpawn={onSpawn} />
        )}

        <FleetMetrics running={running} pendingReview={pendingReviewCount} doneToday={doneToday} todayCost={todayCost} formatCost={formatCost} />
      </div>
    </div>
  )
}

function GlanceHeader({ onSpawn }: { onSpawn: () => void }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <div>
        <div className="fleet-eyebrow">FLEET · GLANCE</div>
        <h2
          style={{
            margin: '4px 0 0',
            fontSize: 20,
            fontWeight: 500,
            color: 'var(--fg)',
            letterSpacing: '-0.01em',
          }}
        >
          Pick an agent to focus, or spawn a new one
        </h2>
      </div>
      <button
        onClick={onSpawn}
        style={{
          height: 30,
          padding: '0 var(--s-3)',
          background: 'var(--accent)',
          color: 'var(--accent-fg)',
          border: 'none',
          borderRadius: 'var(--r-lg)',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        + Spawn agent
      </button>
    </div>
  )
}

function TileGrid({
  agents,
  onSelect,
}: {
  agents: AgentMeta[]
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 'var(--s-3)',
      }}
    >
      {agents.map((agent) => (
        <AgentTile key={agent.id} agent={agent} onClick={() => onSelect(agent.id)} />
      ))}
    </div>
  )
}

function EmptyState({ onSpawn }: { onSpawn: () => void }): React.JSX.Element {
  return (
    <div
      style={{
        padding: 'var(--s-8) var(--s-6)',
        textAlign: 'center',
        color: 'var(--fg-3)',
      }}
    >
      <p style={{ margin: '0 0 var(--s-2)', fontSize: 14 }}>No agents running or completed today.</p>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-4)' }}>
        Click{' '}
        <button
          onClick={onSpawn}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--accent)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          + Spawn agent
        </button>{' '}
        to get started.
      </p>
    </div>
  )
}

interface FleetMetricsProps {
  running: number
  pendingReview: number
  doneToday: number
  todayCost: number
  formatCost: (usd: number) => string
}

function FleetMetrics({ running, pendingReview, doneToday, todayCost, formatCost }: FleetMetricsProps): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--s-3)' }}>
      <MiniStat label="live" value={String(running)} />
      <MiniStat label="review" value={String(pendingReview)} />
      <MiniStat label="done · 24h" value={String(doneToday)} />
      <MiniStat label="cost · 24h" value={formatCost(todayCost)} />
    </div>
  )
}
