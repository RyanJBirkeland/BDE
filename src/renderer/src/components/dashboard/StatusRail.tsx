import type React from 'react'
import './StatusRail.css'

interface DashboardStats {
  active: number
  queued: number
  blocked: number
  review: number
  done: number
  doneToday: number
  failed: number
  actualFailed: number
}

type RailFilter = 'active' | 'queued' | 'done'

interface StatusRailProps {
  stats: DashboardStats
  tokens24h: number
  onFilterClick: (filter: RailFilter) => void
  onNewTaskClick: () => void
}

function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

interface Tile {
  key: string
  label: string
  value: string
  subtext?: string | undefined
  filter: RailFilter | null
  accent?: 'active' | 'default' | undefined
}

export function StatusRail({
  stats,
  tokens24h,
  onFilterClick,
  onNewTaskClick
}: StatusRailProps): React.JSX.Element {
  const tiles: Tile[] = [
    {
      key: 'active',
      label: 'Active',
      value: String(stats.active),
      filter: 'active',
      accent: 'active'
    },
    {
      key: 'queued',
      label: 'Queued',
      value: String(stats.queued),
      filter: 'queued'
    },
    {
      key: 'done',
      label: 'Done',
      value: String(stats.done),
      subtext: `${stats.doneToday} today`,
      filter: 'done'
    },
    {
      key: 'tokens',
      label: 'Tokens 24h',
      value: formatTokensCompact(tokens24h),
      filter: null
    }
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        width: 110
      }}
    >
      {tiles.map((t) => {
        const clickable = t.filter !== null
        return (
          <button
            key={t.key}
            type="button"
            data-role="rail-tile"
            className="dashboard-tile"
            disabled={!clickable}
            onClick={() => {
              if (t.filter) onFilterClick(t.filter)
            }}
          >
            <div
              style={{
                color: t.accent === 'active' ? 'var(--bde-accent)' : 'var(--bde-text)',
                fontSize: 16,
                fontWeight: 700,
                lineHeight: 1
              }}
            >
              {t.value}
            </div>
            <div
              style={{
                fontSize: 8,
                color: 'var(--bde-text-dim)',
                letterSpacing: '0.08em',
                marginTop: 3,
                textTransform: 'uppercase'
              }}
            >
              {t.label}
              {t.subtext && (
                <>
                  {' · '}
                  <span style={{ textTransform: 'none' }}>{t.subtext}</span>
                </>
              )}
            </div>
          </button>
        )
      })}
      <button
        type="button"
        onClick={onNewTaskClick}
        style={{
          background: 'rgba(56, 189, 248, 0.12)',
          border: '1px dashed #38bdf8',
          color: 'var(--bde-accent)',
          padding: 8,
          borderRadius: 5,
          fontSize: 10,
          fontFamily: 'ui-monospace, Menlo, monospace',
          cursor: 'pointer',
          marginTop: 2
        }}
      >
        + New Task
      </button>
    </div>
  )
}
