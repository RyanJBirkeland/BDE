import { NeonCard, MiniChart, type ChartBar } from '../neon'
import { neonVar } from '../neon/types'
import { useDashboardDataStore } from '../../stores/dashboardData'
import { SuccessRing } from './SuccessRing'
import { Zap, Target, Clock } from 'lucide-react'

interface LocalAgent {
  durationMs?: number | null
}

interface ChartsSectionProps {
  chartData: ChartBar[]
  cardErrors: Record<string, string | undefined>
  successRate: number | null
  stats: { done: number; failed: number }
  avgDuration: number | null
  localAgents: LocalAgent[]
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
  cardErrors,
  successRate,
  stats,
  avgDuration,
  localAgents
}: ChartsSectionProps): React.JSX.Element {
  const avgDurationLabel = `${localAgents.filter((a) => a.durationMs != null).length} runs tracked`
  return (
    <>
      <NeonCard accent="cyan" title="Completions by Hour" icon={<Zap size={12} />}>
        {cardErrors.chart ? (
          <div className="dashboard-card-error">
            <div className="dashboard-card-error__message">{cardErrors.chart}</div>
            <button
              className="dashboard-card-error__retry"
              onClick={() => useDashboardDataStore.getState().fetchAll()}
              style={{
                border: `1px solid ${neonVar('red', 'color')}`,
                color: neonVar('red', 'color')
              }}
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

      {/* Stats row: Success Rate + Avg Duration */}
      <div className="dashboard-stats-row">
        <NeonCard accent="cyan" title="Success Rate" icon={<Target size={12} />}>
          <SuccessRing rate={successRate} done={stats.done} failed={stats.failed} />
        </NeonCard>

        <NeonCard accent="blue" title="Avg Duration" icon={<Clock size={12} />}>
          <div className="dashboard-duration-value">
            {avgDuration != null ? formatDurationMs(avgDuration) : '—'}
          </div>
          <div className="dashboard-duration-meta">{avgDurationLabel}</div>
        </NeonCard>
      </div>
    </>
  )
}
