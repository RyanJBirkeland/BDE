import { NeonCard, SankeyPipeline, MiniChart, type ChartBar, type SankeyStageKey } from '../neon'
import { ThroughputChart } from './ThroughputChart'
import { SuccessRateChart } from './SuccessRateChart'
import { LoadAverageChart } from './LoadAverageChart'
import type {
  CompletionBucket,
  LoadSnapshot,
  DailySuccessRate
} from '../../../../shared/ipc-channels'
import type { StatusFilter } from '../../stores/sprintFilters'
import { Activity, Zap, TrendingUp, Cpu, Coins } from 'lucide-react'
import { useDashboardDataStore } from '../../stores/dashboardData'
import './CenterColumn.css'

/** Translates Sankey stage keys to sprint domain StatusFilter values. */
const STAGE_TO_FILTER: Record<SankeyStageKey, StatusFilter> = {
  queued: 'todo',
  active: 'in-progress',
  review: 'awaiting-review',
  done: 'done',
  blocked: 'blocked',
  failed: 'failed'
}

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

interface CenterColumnProps {
  stats: DashboardStats
  partitions: {
    todo: unknown[]
    inProgress: unknown[]
    awaitingReview: unknown[]
    done: unknown[]
    blocked: unknown[]
    failed: unknown[]
  }
  throughputData: CompletionBucket[]
  successTrendData: DailySuccessRate[]
  loadData: LoadSnapshot | null
  tokenTrendData: ChartBar[]
  tokenAvg: string | null
  cardErrors: Record<string, string | undefined>
  onFilterClick: (filter: StatusFilter) => void
}

function ErrorCard({
  message,
  onRetry
}: {
  message: string
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className="dashboard-card-error">
      <div className="dashboard-card-error__message">{message}</div>
      <button className="dashboard-card-error__retry" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

/** Center column with pipeline and charts. */
export function CenterColumn({
  partitions,
  throughputData,
  successTrendData,
  loadData,
  tokenTrendData,
  tokenAvg,
  cardErrors,
  onFilterClick
}: CenterColumnProps): React.JSX.Element {
  const retry = (): Promise<void> => useDashboardDataStore.getState().fetchAll()
  const retryLoad = (): Promise<void> => useDashboardDataStore.getState().fetchLoad()

  return (
    <div className="dashboard-col dashboard-col--center">
      <NeonCard accent="cyan" title="Pipeline" icon={<Activity size={12} />}>
        <SankeyPipeline
          stages={{
            queued: partitions.todo.length,
            active: partitions.inProgress.length,
            review: partitions.awaitingReview.length,
            done: partitions.done.length,
            blocked: partitions.blocked.length,
            failed: partitions.failed.length
          }}
          onStageClick={(stage) => onFilterClick(STAGE_TO_FILTER[stage])}
        />
      </NeonCard>

      <NeonCard accent="cyan" title="Throughput · last 24h" icon={<Zap size={12} />}>
        {cardErrors.throughput ? (
          <ErrorCard message={cardErrors.throughput} onRetry={retry} />
        ) : (
          <ThroughputChart data={throughputData} />
        )}
      </NeonCard>

      <NeonCard accent="cyan" title="Success rate · last 14d" icon={<TrendingUp size={12} />}>
        {cardErrors.successTrend ? (
          <ErrorCard message={cardErrors.successTrend} onRetry={retry} />
        ) : (
          <SuccessRateChart data={successTrendData} />
        )}
      </NeonCard>

      <div data-chart="load-average">
        <NeonCard accent="cyan" title="System load · last 10m" icon={<Cpu size={12} />}>
          {cardErrors.loadAverage ? (
            <ErrorCard message={cardErrors.loadAverage} onRetry={retryLoad} />
          ) : loadData ? (
            <LoadAverageChart samples={loadData.samples} cpuCount={loadData.cpuCount} />
          ) : (
            <div style={{ color: 'var(--bde-text-dim)', fontSize: 10, padding: 12 }}>
              Loading...
            </div>
          )}
        </NeonCard>
      </div>

      <NeonCard accent="cyan" title="Tokens / run" icon={<Coins size={12} />}>
        <div
          className="tokens-per-run-row"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <strong style={{ color: 'var(--bde-text)', fontSize: 14, fontWeight: 700 }}>
              {tokenAvg ?? '—'}
            </strong>
            <span style={{ color: 'var(--bde-text-dim)', fontSize: 9 }}>last 20 runs</span>
          </div>
          <div style={{ flex: 1, maxWidth: 160 }}>
            <MiniChart data={tokenTrendData} height={28} />
          </div>
        </div>
      </NeonCard>
    </div>
  )
}
