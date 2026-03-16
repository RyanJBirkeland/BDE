/**
 * CostView — token cost analytics dashboard.
 * Fetches session data via gateway RPC (sessions_list) and computes costs
 * using hardcoded Claude model pricing. Displays: 7-day spend bar chart,
 * model breakdown donut, sortable per-session table, and CSV export. Polls every 30s.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { invokeTool } from '../lib/rpc'
import { type ModelKey, resolveModel, calcCost } from '../lib/cost'
import { EmptyState } from '../components/ui/EmptyState'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Download } from 'lucide-react'
import { POLL_SPRINT_INTERVAL } from '../lib/constants'

interface SessionWithTokens {
  key: string
  model: string
  displayName: string
  updatedAt: number
  totalTokens: number
  contextTokens: number
}

interface SessionCost extends SessionWithTokens {
  inputTokens: number
  outputTokens: number
  cost: number
  modelKey: ModelKey
}

type SortField = 'cost' | 'inputTokens' | 'outputTokens' | 'updatedAt'

const MODEL_COLORS: Record<ModelKey, string> = {
  haiku: '#3B82F6',
  sonnet: '#00D37F',
  opus: '#F59E0B',
}

function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`
  return `$${cost.toFixed(4)}`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function isWithinMs(updatedAt: number, ms: number): boolean {
  return updatedAt >= Date.now() - ms
}

const DAY_MS = 86_400_000

function getDayLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function getShortDay(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ── SVG Bar Chart (last 7 days) ────────────────────────────

function DailyChart({ sessions }: { sessions: SessionCost[] }): React.JSX.Element {
  const days = useMemo(() => {
    const now = new Date()
    const result: { label: string; shortLabel: string; cost: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const dayStart = d.getTime()
      const dayEnd = dayStart + DAY_MS
      const cost = sessions
        .filter((s) => s.updatedAt >= dayStart && s.updatedAt < dayEnd)
        .reduce((sum, s) => sum + s.cost, 0)
      result.push({ label: getDayLabel(d), shortLabel: getShortDay(d), cost })
    }
    return result
  }, [sessions])

  const maxCost = Math.max(...days.map((d) => d.cost), 0.01)
  const W = 420
  const H = 160
  const barW = 36
  const gap = (W - barW * 7) / 8
  const topPad = 20

  return (
    <div className="cost-chart">
      <h3 className="cost-section__title bde-section-title">Daily Spend</h3>
      <svg viewBox={`0 0 ${W} ${H + 28}`} className="cost-chart__svg">
        {days.map((d, i) => {
          const x = gap + i * (barW + gap)
          const barH = (d.cost / maxCost) * (H - topPad)
          const y = H - barH
          const isToday = i === 6
          const opacity = isToday ? 1 : 0.45 + (i / 6) * 0.35
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(barH, 2)}
                rx={4}
                fill="var(--bde-accent)"
                opacity={opacity}
              />
              {d.cost > 0 && (
                <text
                  x={x + barW / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fill="var(--bde-text-muted)"
                  fontSize={9}
                  fontFamily="var(--bde-font-code)"
                >
                  {formatCost(d.cost)}
                </text>
              )}
              <text
                x={x + barW / 2}
                y={H + 16}
                textAnchor="middle"
                fill="var(--bde-text-muted)"
                fontSize={10}
                fontFamily="var(--bde-font-ui)"
              >
                {d.shortLabel}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── SVG Donut Chart (model breakdown) ──────────────────────

function ModelDonut({ sessions }: { sessions: SessionCost[] }): React.JSX.Element {
  const breakdown = useMemo(() => {
    const totals: Record<ModelKey, number> = { haiku: 0, sonnet: 0, opus: 0 }
    for (const s of sessions) {
      totals[s.modelKey] += s.cost
    }
    const total = totals.haiku + totals.sonnet + totals.opus
    return { totals, total }
  }, [sessions])

  const { totals, total } = breakdown
  const R = 60
  const r = 38
  const cx = 80
  const cy = 80
  const models: ModelKey[] = ['opus', 'sonnet', 'haiku']

  let cumAngle = -Math.PI / 2

  const arcs = models
    .filter((m) => totals[m] > 0)
    .map((m) => {
      const pct = total > 0 ? totals[m] / total : 0
      const angle = pct * Math.PI * 2
      const startAngle = cumAngle
      const endAngle = cumAngle + angle
      cumAngle = endAngle

      const largeArc = angle > Math.PI ? 1 : 0
      const x1 = cx + R * Math.cos(startAngle)
      const y1 = cy + R * Math.sin(startAngle)
      const x2 = cx + R * Math.cos(endAngle)
      const y2 = cy + R * Math.sin(endAngle)
      const x3 = cx + r * Math.cos(endAngle)
      const y3 = cy + r * Math.sin(endAngle)
      const x4 = cx + r * Math.cos(startAngle)
      const y4 = cy + r * Math.sin(startAngle)

      const d = [
        `M ${x1} ${y1}`,
        `A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2}`,
        `L ${x3} ${y3}`,
        `A ${r} ${r} 0 ${largeArc} 0 ${x4} ${y4}`,
        'Z',
      ].join(' ')

      return { model: m, d, pct }
    })

  return (
    <div className="cost-donut">
      <h3 className="cost-section__title bde-section-title">Model Breakdown</h3>
      <div className="cost-donut__row">
        <svg viewBox="0 0 160 160" className="cost-donut__svg">
          {total === 0 ? (
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--bde-border)" strokeWidth={R - r} />
          ) : (
            arcs.map((a) => <path key={a.model} d={a.d} fill={MODEL_COLORS[a.model]} />)
          )}
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            fill="var(--bde-text)"
            fontSize={14}
            fontWeight={600}
            fontFamily="var(--bde-font-code)"
          >
            {formatCost(total)}
          </text>
          <text
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            fill="var(--bde-text-muted)"
            fontSize={9}
            fontFamily="var(--bde-font-ui)"
          >
            total
          </text>
        </svg>
        <div className="cost-donut__legend">
          {models.map((m) => (
            <div key={m} className="cost-donut__legend-item">
              <span className="cost-donut__dot" style={{ background: MODEL_COLORS[m] }} />
              <span className="cost-donut__model-name">{m}</span>
              <span className="cost-donut__model-cost">{formatCost(totals[m])}</span>
              <span className="cost-donut__model-pct">
                {total > 0 ? `${((totals[m] / total) * 100).toFixed(0)}%` : '0%'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Session Table ──────────────────────────────────────────

function SessionTable({
  sessions,
  sortField,
  onSort,
}: {
  sessions: SessionCost[]
  sortField: SortField
  onSort: (f: SortField) => void
}): React.JSX.Element {
  const sortIndicator = (f: SortField) => (sortField === f ? ' ▾' : '')

  return (
    <div className="cost-view__table-wrap">
      <table className="cost-table">
        <thead>
          <tr>
            <th>Session</th>
            <th>Model</th>
            <th className="cost-table__num cost-table__sortable" onClick={() => onSort('inputTokens')}>
              Input Tokens{sortIndicator('inputTokens')}
            </th>
            <th className="cost-table__num cost-table__sortable" onClick={() => onSort('outputTokens')}>
              Output Tokens{sortIndicator('outputTokens')}
            </th>
            <th className="cost-table__num cost-table__sortable" onClick={() => onSort('cost')}>
              Cost{sortIndicator('cost')}
            </th>
            <th className="cost-table__num cost-table__sortable" onClick={() => onSort('updatedAt')}>
              Last Active{sortIndicator('updatedAt')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.key}>
              <td className="cost-table__session">
                <span className="cost-table__key">{s.displayName || s.key}</span>
              </td>
              <td className="cost-table__model">
                <span className="cost-table__model-badge" style={{ borderColor: MODEL_COLORS[s.modelKey] }}>
                  {s.modelKey}
                </span>
              </td>
              <td className="cost-table__num">{formatTokens(s.inputTokens)}</td>
              <td className="cost-table__num">{formatTokens(s.outputTokens)}</td>
              <td className="cost-table__num cost-table__cost">{formatCost(s.cost)}</td>
              <td className="cost-table__num cost-table__date">{formatDate(s.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Export CSV ──────────────────────────────────────────────

function exportCsv(sessions: SessionCost[]): void {
  const header = 'session,model,input_tokens,output_tokens,cost,date'
  const rows = sessions.map((s) => {
    const date = new Date(s.updatedAt).toISOString()
    const name = (s.displayName || s.key).replace(/,/g, ' ')
    return `${name},${s.modelKey},${s.inputTokens},${s.outputTokens},${s.cost.toFixed(6)},${date}`
  })
  const csv = [header, ...rows].join('\n')
  navigator.clipboard.writeText(csv)
}

// ── Main View ──────────────────────────────────────────────

export default function CostView(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionWithTokens[]>([])
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField>('cost')
  const [copied, setCopied] = useState(false)

  const fetchSessions = useCallback(async () => {
    try {
      const data = (await invokeTool('sessions_list')) as {
        sessions: SessionWithTokens[]
        count: number
      }
      setSessions(data.sessions ?? [])
    } catch {
      // silently fail — will retry on next poll
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    const interval = setInterval(fetchSessions, POLL_SPRINT_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchSessions])

  const sessionsWithCost = useMemo(() => {
    return sessions
      .map((s) => {
        const modelKey = resolveModel(s.model)
        // TODO(audit): contextTokens != input tokens — gateway should expose inputTokens/outputTokens directly
        const inputTokens = s.contextTokens ?? 0
        const outputTokens = Math.max(0, (s.totalTokens ?? 0) - inputTokens)
        return {
          ...s,
          inputTokens,
          outputTokens,
          modelKey,
          cost: calcCost(inputTokens, outputTokens, modelKey),
        }
      })
      .sort((a, b) => {
        if (sortField === 'updatedAt') return b.updatedAt - a.updatedAt
        return (b[sortField] as number) - (a[sortField] as number)
      })
  }, [sessions, sortField])

  const todayCost = sessionsWithCost.filter((s) => isWithinMs(s.updatedAt, DAY_MS)).reduce((sum, s) => sum + s.cost, 0)

  const weekCost = sessionsWithCost
    .filter((s) => isWithinMs(s.updatedAt, 7 * DAY_MS))
    .reduce((sum, s) => sum + s.cost, 0)

  const monthCost = sessionsWithCost
    .filter((s) => isWithinMs(s.updatedAt, 30 * DAY_MS))
    .reduce((sum, s) => sum + s.cost, 0)

  const allTimeCost = sessionsWithCost.reduce((sum, s) => sum + s.cost, 0)

  const handleExport = useCallback(() => {
    exportCsv(sessionsWithCost)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [sessionsWithCost])

  if (loading) {
    return (
      <div className="cost-view">
        <div className="cost-view__cards">
          <div className="bde-skeleton" style={{ height: 80 }} />
          <div className="bde-skeleton" style={{ height: 80 }} />
          <div className="bde-skeleton" style={{ height: 80 }} />
          <div className="bde-skeleton" style={{ height: 80 }} />
        </div>
        <div className="cost-view__charts">
          <div className="bde-skeleton" style={{ height: 200 }} />
          <div className="bde-skeleton" style={{ height: 200 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="cost-view">
      <div className="cost-view__header">
        <h2 className="cost-view__title">Cost Tracker</h2>
        <Button variant="ghost" size="sm" onClick={handleExport} title="Copy CSV to clipboard">
          <Download size={14} />
          {copied ? 'Copied!' : 'Export CSV'}
        </Button>
      </div>

      <div className="cost-view__cards">
        <Card padding="md" className="cost-stat-card">
          <span className="cost-stat-card__label">Today</span>
          <span className="cost-stat-card__value">{formatCost(todayCost)}</span>
        </Card>
        <Card padding="md" className="cost-stat-card">
          <span className="cost-stat-card__label">This Week</span>
          <span className="cost-stat-card__value">{formatCost(weekCost)}</span>
        </Card>
        <Card padding="md" className="cost-stat-card">
          <span className="cost-stat-card__label">This Month</span>
          <span className="cost-stat-card__value">{formatCost(monthCost)}</span>
        </Card>
        <Card padding="md" className="cost-stat-card">
          <span className="cost-stat-card__label">All Time</span>
          <span className="cost-stat-card__value">{formatCost(allTimeCost)}</span>
        </Card>
      </div>

      <div className="cost-view__charts">
        <DailyChart sessions={sessionsWithCost} />
        <ModelDonut sessions={sessionsWithCost} />
      </div>

      {sessionsWithCost.length === 0 ? (
        <EmptyState
          title="No session data yet"
          description="Costs will appear once agents run"
        />
      ) : (
        <SessionTable sessions={sessionsWithCost} sortField={sortField} onSort={setSortField} />
      )}
    </div>
  )
}
