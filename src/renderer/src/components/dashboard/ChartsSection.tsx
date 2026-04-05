import { NeonCard, MiniChart, type ChartBar } from '../neon'
import { useDashboardDataStore } from '../../stores/dashboardData'
import { SuccessRing } from './SuccessRing'
import { SuccessTrendChart } from './SuccessTrendChart'
import { Zap, Target, Clock, TrendingUp } from 'lucide-react'

interface LocalAgent {
  durationMs?: number | null
}

interface DailySuccessRate {
  date: string
  successRate: number | null
  doneCount: number
  failedCount: number
}

interface ChartsSectionProps {
  chartData: ChartBar[]
  burndownData: ChartBar[]
  cardErrors: Record<string, string | undefined>
  successRate: number | null
  stats: { done: number; failed: number; actualFailed: number }
  avgDuration: number | null
  avgTaskDuration: number | null
  taskDurationCount: number
  localAgents: LocalAgent[]
  successTrendData: DailySuccessRate[]
}

/** Format milliseconds to human-readable duration. */
function formatDurationMs(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return `${m}m ${rem}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Center column with pipeline visualization and charts. */
export function ChartsSection({
  chartData,
  burndownData,
  cardErrors,
  successRate,
  stats,
  avgDuration,
  avgTaskDuration,
  taskDurationCount,
  localAgents,
  successTrendData
}: ChartsSectionProps): React.JSX.Element {
  // Prefer task-level duration (more accurate for multi-retry tasks), fallback to agent-run duration
  const displayDuration = avgTaskDuration ?? avgDuration
  const durationLabel =
    taskDurationCount > 0
      ? `${taskDurationCount} task${taskDurationCount !== 1 ? 's' : ''} tracked`
      : `${localAgents.filter((a) => a.durationMs != null).length} runs tracked`

  return (
    <>
      <NeonCard accent="cyan" title="Completions by Hour" icon={<Zap size={12} />}>
        {cardErrors.chart ? (
          <div className="dashboard-card-error">
            <div className="dashboard-card-error__message">{cardErrors.chart}</div>
            <button
              className="dashboard-card-error__retry"
              onClick={() => useDashboardDataStore.getState().fetchAll()}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <MiniChart data={chartData} height={120} />
            <div className="dashboard-chart-caption">completions per hour, last 24h</div>
          </>
        )}
      </NeonCard>

      <NeonCard accent="cyan" title="Success Trend" icon={<TrendingUp size={12} />}>
        {cardErrors.successTrend ? (
          <div className="dashboard-card-error">
            <div className="dashboard-card-error__message">{cardErrors.successTrend}</div>
            <button
              className="dashboard-card-error__retry"
              onClick={() => useDashboardDataStore.getState().fetchAll()}
            >
              Retry
            </button>
          </div>
        ) : (
          <SuccessTrendChart data={successTrendData} />
        )}
      </NeonCard>

      <NeonCard accent="cyan" title="Sprint Burn-Down" icon={<Target size={12} />}>
        {cardErrors.burndown ? (
          <div className="dashboard-card-error">
            <div className="dashboard-card-error__message">{cardErrors.burndown}</div>
            <button
              className="dashboard-card-error__retry"
              onClick={() => useDashboardDataStore.getState().fetchAll()}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <MiniChart data={burndownData} height={120} />
            <div className="dashboard-chart-caption">tasks completed, last 7 days</div>
          </>
        )}
      </NeonCard>

      {/* Stats row: Success Rate + Avg Duration */}
      <div className="dashboard-stats-row">
        <NeonCard accent="cyan" title="Success Rate" icon={<Target size={12} />}>
          <SuccessRing rate={successRate} done={stats.done} failed={stats.actualFailed} />
        </NeonCard>

        <NeonCard accent="blue" title="Avg Task Duration" icon={<Clock size={12} />}>
          <div className="dashboard-duration-value">
            {displayDuration != null ? formatDurationMs(displayDuration) : '—'}
          </div>
          <div className="dashboard-duration-meta">{durationLabel}</div>
        </NeonCard>
      </div>
    </>
  )
}
