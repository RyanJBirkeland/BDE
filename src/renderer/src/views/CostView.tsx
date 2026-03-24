/**
 * CostView — real cost analytics from agent_runs DB data.
 * Two-panel layout: Claude Code (subscription, informational) + OpenClaw API (token usage).
 * Task table shows per-run cost, duration, and cache efficiency.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useVisibilityAwareInterval } from '../hooks/useVisibilityAwareInterval'
import type { AgentRunCostRow, CostSummary } from '../../../shared/types'
import { EmptyState } from '../components/ui/EmptyState'
import { Button } from '../components/ui/Button'
import { Download, RefreshCw, BarChart, ExternalLink } from 'lucide-react'
import { POLL_COST_INTERVAL, AGENT_HISTORY_LIMIT, FLASH_DURATION_MS } from '../lib/constants'
import { useCostDataStore } from '../stores/costData'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'

// ── Formatting helpers ──────────────────────────────────

function formatCost(cost: number | null | undefined): string {
  if (cost == null || Number.isNaN(cost)) return '--'
  if (cost >= 1) return `$${cost.toFixed(2)}`
  return `$${cost.toFixed(4)}`
}

function formatTokens(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '--'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '--'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return `${min}m ${rem}s`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function cacheHitPct(row: AgentRunCostRow): number | null {
  const cacheRead = row.cache_read ?? 0
  const tokensIn = row.tokens_in ?? 0
  const total = cacheRead + tokensIn
  if (total === 0 || Number.isNaN(total)) return null
  const pct = (cacheRead / total) * 100
  return Number.isNaN(pct) ? null : pct
}

function costTier(cost: number | null | undefined): 'green' | 'yellow' | 'red' | 'gray' {
  if (cost == null || Number.isNaN(cost)) return 'gray'
  if (cost < 0.5) return 'green'
  if (cost <= 1.0) return 'yellow'
  return 'red'
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s
}

// ── Claude Code Panel ───────────────────────────────────

function ClaudeCodePanel({ summary }: { summary: CostSummary }): React.JSX.Element {
  return (
    <div className="cost-panel cost-panel--blue">
      <h3 className="cost-panel__title">Claude Code</h3>
      <span className="cost-panel__badge cost-panel__badge--blue">Subscription</span>

      <div className="cost-panel__stats">
        <div className="cost-panel__stat">
          <span className="cost-panel__stat-label">Tasks completed</span>
          <span className="cost-panel__stat-value">
            {summary.tasksToday} today / {summary.tasksThisWeek} week / {summary.tasksAllTime} all
          </span>
        </div>
        <div className="cost-panel__stat">
          <span className="cost-panel__stat-label">Total tokens this week</span>
          <span className="cost-panel__stat-value">{formatTokens(summary.totalTokensThisWeek)}</span>
        </div>
        <div className="cost-panel__stat">
          <span className="cost-panel__stat-label">Avg cost per task</span>
          <span className="cost-panel__stat-value">
            {summary.avgCostPerTask !== null ? formatCost(summary.avgCostPerTask) : '--'}
          </span>
          <span className="cost-panel__stat-note">est. API equivalent — you pay flat rate</span>
        </div>
        {summary.mostExpensiveTask && (
          <div className="cost-panel__stat">
            <span className="cost-panel__stat-label">Most expensive this week</span>
            <span className="cost-panel__stat-value">
              {formatCost(summary.mostExpensiveTask.costUsd)}
            </span>
            <span className="cost-panel__stat-note">{truncate(summary.mostExpensiveTask.task, 60)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Task Table ──────────────────────────────────────────

type SortField = 'cost_usd' | 'duration_ms' | 'started_at'

function TaskTable({
  runs,
  sortField,
  onSort,
  onRowClick,
}: {
  runs: AgentRunCostRow[]
  sortField: SortField
  onSort: (f: SortField) => void
  onRowClick: (run: AgentRunCostRow) => void
}): React.JSX.Element {
  const sortIndicator = (f: SortField): string => (sortField === f ? ' \u25BE' : '')

  return (
    <div className="cost-view__table-wrap">
      <table className="cost-table">
        <thead>
          <tr>
            <th>Task</th>
            <th className="cost-table__num cost-table__sortable" onClick={() => onSort('cost_usd')}>
              Est. Cost{sortIndicator('cost_usd')}
            </th>
            <th className="cost-table__num cost-table__sortable" onClick={() => onSort('duration_ms')}>
              Duration{sortIndicator('duration_ms')}
            </th>
            <th className="cost-table__num">Turns</th>
            <th className="cost-table__num">Cache Hit %</th>
            <th>Repo</th>
            <th>PR</th>
            <th className="cost-table__num cost-table__sortable" onClick={() => onSort('started_at')}>
              Date{sortIndicator('started_at')}
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const tier = costTier(r.cost_usd)
            const cache = cacheHitPct(r)
            return (
              <tr
                key={r.id}
                className={`cost-table__row cost-table__row--${tier}`}
                onClick={() => onRowClick(r)}
              >
                <td className="cost-table__session">
                  <span className="cost-table__key">{truncate(r.task || r.id.slice(0, 8), 50)}</span>
                </td>
                <td className="cost-table__num cost-table__cost">{formatCost(r.cost_usd)}</td>
                <td className="cost-table__num">{formatDuration(r.duration_ms)}</td>
                <td className="cost-table__num">{r.num_turns ?? '--'}</td>
                <td className="cost-table__num">{cache !== null ? `${cache.toFixed(0)}%` : '--'}</td>
                <td className="cost-table__model">
                  <span className="cost-table__repo-badge">{r.repo || '--'}</span>
                </td>
                <td>
                  {r.pr_url ? (
                    <a
                      className="cost-table__pr-link"
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        window.api.openExternal(r.pr_url!)
                      }}
                    >
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span className="cost-table__no-pr">--</span>
                  )}
                </td>
                <td className="cost-table__num cost-table__date">{formatDate(r.started_at)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── CSV Export ───────────────────────────────────────────

function exportCsv(runs: AgentRunCostRow[]): void {
  const header = 'task,repo,cost_usd,duration_ms,turns,cache_hit_pct,tokens_in,tokens_out,pr_url,date'
  const rows = runs.map((r) => {
    const cache = cacheHitPct(r)
    const title = (r.task || r.id).replace(/,/g, ' ')
    const date = new Date(r.started_at).toISOString()
    return `${title},${r.repo},${r.cost_usd ?? ''},${r.duration_ms ?? ''},${r.num_turns ?? ''},${cache !== null ? cache.toFixed(1) : ''},${r.tokens_in ?? ''},${r.tokens_out ?? ''},${r.pr_url ?? ''},${date}`
  })
  const csv = [header, ...rows].join('\n')
  navigator.clipboard.writeText(csv)
}

// ── Main View ───────────────────────────────────────────

export default function CostView(): React.JSX.Element {
  const reduced = useReducedMotion()
  const [summary, setSummary] = useState<CostSummary | null>(null)
  const [runs, setRuns] = useState<AgentRunCostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField>('started_at')
  const [copied, setCopied] = useState(false)
  const refreshStore = useCostDataStore((s) => s.fetchLocalAgents)

  const fetchData = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        window.api.cost.summary(),
        window.api.cost.agentRuns(AGENT_HISTORY_LIMIT),
      ])
      setSummary(s)
      setRuns(r)
      // Keep the shared cost store in sync so TitleBar totalCost updates
      refreshStore()
    } catch {
      // Silently fail — will retry on next poll
    } finally {
      setLoading(false)
    }
  }, [refreshStore])

  useEffect(() => { fetchData() }, [fetchData])
  useVisibilityAwareInterval(fetchData, POLL_COST_INTERVAL)

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      if (sortField === 'started_at') {
        return new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
      }
      const av = a[sortField] ?? -1
      const bv = b[sortField] ?? -1
      return (bv as number) - (av as number)
    })
  }, [runs, sortField])

  const handleExport = useCallback(() => {
    exportCsv(sortedRuns)
    setCopied(true)
    setTimeout(() => setCopied(false), FLASH_DURATION_MS)
  }, [sortedRuns])

  const handleRowClick = useCallback((run: AgentRunCostRow) => {
    window.dispatchEvent(
      new CustomEvent('bde:navigate', {
        detail: { view: 'agents', sessionId: run.id },
      })
    )
  }, [])

  if (loading) {
    return (
      <motion.div className="cost-view cost-view--glass" variants={VARIANTS.fadeIn} initial="initial" animate="animate" transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}>
        <div className="cost-view__header">
          <span className="cost-view__title">Cost Tracker</span>
        </div>
        <div className="cost-view__scroll">
          <div className="cost-view__panels">
            <div className="bde-skeleton" style={{ height: 200 }} />
            <div className="bde-skeleton" style={{ height: 200 }} />
          </div>
          <div className="bde-skeleton" style={{ height: 300 }} />
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div className="cost-view cost-view--glass" variants={VARIANTS.fadeIn} initial="initial" animate="animate" transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}>
      <div className="cost-view__header">
        <span className="cost-view__title">Cost Tracker</span>
        <div className="cost-view__header-actions">
          <Button variant="ghost" size="sm" onClick={fetchData} title="Refresh data">
            <RefreshCw size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport} title="Copy CSV to clipboard">
            <Download size={14} />
            {copied ? 'Copied!' : 'Export CSV'}
          </Button>
        </div>
      </div>

      <div className="cost-view__scroll">
        <div className="cost-view__panels">
          {summary && <ClaudeCodePanel summary={summary} />}
        </div>

        {sortedRuns.length === 0 ? (
          <EmptyState
            icon={<BarChart size={24} />}
            title="No completed agent runs"
            description="Complete a task to see cost breakdown"
          />
        ) : (
          <>
            <h3 className="cost-section__title bde-section-title">Recent Agent Runs</h3>
            <TaskTable
              runs={sortedRuns}
              sortField={sortField}
              onSort={setSortField}
              onRowClick={handleRowClick}
            />
          </>
        )}
      </div>
    </motion.div>
  )
}
