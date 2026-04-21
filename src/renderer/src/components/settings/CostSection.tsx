/**
 * CostSection — token usage analytics from agent_runs DB data.
 * Claude Code subscription = flat rate, so tokens are the meaningful metric.
 * Task table shows per-run token usage, duration, and cache efficiency.
 */
import './CostSection.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentRunSummary, CostSummary } from '../../../../shared/types'
import { EmptyState } from '../ui/EmptyState'
import { Button } from '../ui/Button'
import { Download, RefreshCw, BarChart, ExternalLink } from 'lucide-react'
import { AGENT_HISTORY_LIMIT, FLASH_DURATION_MS } from '../../lib/constants'
import { useCostDataStore } from '../../stores/costData'
import { formatDurationMs, formatTokens } from '../../lib/format'
import { SettingsCard } from './SettingsCard'

// ── Formatting helpers ──────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function cacheHitPct(row: AgentRunSummary): number | null {
  const cacheRead = row.cacheRead ?? 0
  const tokensIn = row.tokensIn ?? 0
  const total = cacheRead + tokensIn
  if (total === 0 || Number.isNaN(total)) return null
  const pct = (cacheRead / total) * 100
  return Number.isNaN(pct) ? null : pct
}

function totalTokens(row: AgentRunSummary): number {
  return (row.tokensIn ?? 0) + (row.tokensOut ?? 0)
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s
}

// ── Claude Code Panel ───────────────────────────────────

function ClaudeCodePanel({ summary }: { summary: CostSummary }): React.JSX.Element {
  return (
    <div className="bde-card bde-card--pad-none cost-panel cost-panel--blue">
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
          <span className="cost-panel__stat-value">
            {formatTokens(summary.totalTokensThisWeek)}
          </span>
        </div>
        <div className="cost-panel__stat">
          <span className="cost-panel__stat-label">Avg tokens per task</span>
          <span className="cost-panel__stat-value">
            {summary.avgTokensPerTask !== null
              ? formatTokens(Math.round(summary.avgTokensPerTask))
              : '--'}
          </span>
        </div>
        {summary.mostTokenIntensiveTask && (
          <div className="cost-panel__stat">
            <span className="cost-panel__stat-label">Most token-intensive this week</span>
            <span className="cost-panel__stat-value">
              {formatTokens(summary.mostTokenIntensiveTask.totalTokens)}
            </span>
            <span className="cost-panel__stat-note">
              {truncate(summary.mostTokenIntensiveTask.task, 60)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Task Table ──────────────────────────────────────────

type SortField = 'tokens' | 'durationMs' | 'startedAt'

function TaskTable({
  runs,
  sortField,
  onSort,
  onRowClick
}: {
  runs: AgentRunSummary[]
  sortField: SortField
  onSort: (f: SortField) => void
  onRowClick: (run: AgentRunSummary) => void
}): React.JSX.Element {
  const sortIndicator = (f: SortField): string => (sortField === f ? ' \u25BE' : '')

  const handleSortKeyDown = (field: SortField) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSort(field)
    }
  }

  return (
    <div className="cost-view__table-wrap">
      <table className="cost-table">
        <thead>
          <tr>
            <th>Task</th>
            <th
              className="cost-table__num cost-table__sortable"
              onClick={() => onSort('tokens')}
              onKeyDown={handleSortKeyDown('tokens')}
              tabIndex={0}
              role="columnheader"
              aria-sort={sortField === 'tokens' ? 'descending' : 'none'}
            >
              Tokens{sortIndicator('tokens')}
            </th>
            <th
              className="cost-table__num cost-table__sortable"
              onClick={() => onSort('durationMs')}
              onKeyDown={handleSortKeyDown('durationMs')}
              tabIndex={0}
              role="columnheader"
              aria-sort={sortField === 'durationMs' ? 'descending' : 'none'}
            >
              Duration{sortIndicator('durationMs')}
            </th>
            <th className="cost-table__num">Turns</th>
            <th className="cost-table__num">Cache Hit %</th>
            <th>Repo</th>
            <th>PR</th>
            <th
              className="cost-table__num cost-table__sortable"
              onClick={() => onSort('startedAt')}
              onKeyDown={handleSortKeyDown('startedAt')}
              tabIndex={0}
              role="columnheader"
              aria-sort={sortField === 'startedAt' ? 'descending' : 'none'}
            >
              Date{sortIndicator('startedAt')}
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const cache = cacheHitPct(r)
            return (
              <tr
                key={r.id}
                className="cost-table__row"
                onClick={() => onRowClick(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onRowClick(r)
                  }
                }}
                tabIndex={0}
              >
                <td className="cost-table__session" title={r.task || r.id}>
                  <span className="cost-table__key">
                    {truncate(r.task || r.id.slice(0, 8), 50)}
                  </span>
                </td>
                <td className="cost-table__num">{formatTokens(totalTokens(r))}</td>
                <td className="cost-table__num">{formatDurationMs(r.durationMs)}</td>
                <td className="cost-table__num">{r.numTurns ?? '--'}</td>
                <td className="cost-table__num">
                  {cache !== null ? `${cache.toFixed(0)}%` : '--'}
                </td>
                <td className="cost-table__model">
                  <span className="cost-table__repo-badge">{r.repo || '--'}</span>
                </td>
                <td>
                  {r.prUrl ? (
                    <a
                      className="cost-table__pr-link"
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        window.api.window.openExternal(r.prUrl!)
                      }}
                    >
                      <ExternalLink size={12} />
                    </a>
                  ) : (
                    <span className="cost-table__no-pr">--</span>
                  )}
                </td>
                <td className="cost-table__num cost-table__date">{formatDate(r.startedAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── CSV Export ───────────────────────────────────────────

function exportCsv(runs: AgentRunSummary[]): void {
  const header =
    'task,repo,tokens_total,tokens_in,tokens_out,duration_ms,turns,cache_hit_pct,pr_url,date'
  const rows = runs.map((r) => {
    const cache = cacheHitPct(r)
    const title = (r.task || r.id).replace(/,/g, ' ')
    const date = new Date(r.startedAt).toISOString()
    return `${title},${r.repo},${totalTokens(r)},${r.tokensIn ?? ''},${r.tokensOut ?? ''},${r.durationMs ?? ''},${r.numTurns ?? ''},${cache !== null ? cache.toFixed(1) : ''},${r.prUrl ?? ''},${date}`
  })
  const csv = [header, ...rows].join('\n')
  navigator.clipboard.writeText(csv)
}

// ── Main Section ───────────────────────────────────────────

export function CostSection(): React.JSX.Element {
  const [summary, setSummary] = useState<CostSummary | null>(null)
  const [runs, setRuns] = useState<AgentRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('startedAt')
  const [copied, setCopied] = useState(false)
  const refreshStore = useCostDataStore((s) => s.fetchLocalAgents)

  const fetchData = useCallback(async () => {
    try {
      setError(null)
      const [s, r] = await Promise.all([
        window.api.cost.summary(),
        window.api.cost.agentRuns(AGENT_HISTORY_LIMIT)
      ])
      setSummary(s)
      setRuns(r)
      // Keep the shared cost store in sync so TitleBar totalTokens updates
      refreshStore()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cost data')
    } finally {
      setLoading(false)
    }
  }, [refreshStore])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      if (sortField === 'startedAt') {
        return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      }
      if (sortField === 'tokens') {
        return totalTokens(b) - totalTokens(a)
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

  const handleRowClick = useCallback((run: AgentRunSummary) => {
    window.dispatchEvent(
      new CustomEvent('bde:navigate', {
        detail: { view: 'agents', sessionId: run.id }
      })
    )
  }, [])

  if (loading) {
    return (
      <div className="cost-view cost-view--glass" style={{ height: '100%' }}>
        <div className="cost-view__scroll">
          <div className="cost-view__panels">
            <div className="bde-skeleton" style={{ height: 200 }} />
            <div className="bde-skeleton" style={{ height: 200 }} />
          </div>
          <div className="bde-skeleton" style={{ height: 300 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="cost-view cost-view--glass" style={{ height: '100%' }}>
      <div className="cost-view__scroll">
        {error && (
          <div className="cost-view__error" role="alert">
            <span>Failed to load cost data: {error}</span>
            <button type="button" onClick={fetchData}>
              Retry
            </button>
          </div>
        )}
        {summary && (
          <SettingsCard title="Claude Code Usage" subtitle="Token usage and agent metrics">
            <ClaudeCodePanel summary={summary} />
          </SettingsCard>
        )}

        {sortedRuns.length === 0 ? (
          <EmptyState
            icon={<BarChart size={24} />}
            title="No completed agent runs"
            description="Complete a task to see usage breakdown"
          />
        ) : (
          <SettingsCard
            title="Task History"
            noPadding
            footer={
              <>
                <Button variant="ghost" size="sm" onClick={fetchData} title="Refresh data">
                  <RefreshCw size={14} />
                  Refresh
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExport}
                  title="Copy CSV to clipboard"
                >
                  <Download size={14} />
                  {copied ? 'Copied!' : 'Export CSV'}
                </Button>
              </>
            }
          >
            <TaskTable
              runs={sortedRuns}
              sortField={sortField}
              onSort={setSortField}
              onRowClick={handleRowClick}
            />
          </SettingsCard>
        )}
      </div>
    </div>
  )
}
