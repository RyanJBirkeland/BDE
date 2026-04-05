import { NeonCard, SankeyPipeline, type ChartBar } from '../neon'
import { ChartsSection } from './ChartsSection'
import { StatusFilter } from '../../stores/sprintUI'
import { Activity, GitPullRequest, XCircle, AlertTriangle } from 'lucide-react'

interface LocalAgent {
  durationMs?: number | null
}

interface DailySuccessRate {
  date: string
  successRate: number | null
  doneCount: number
  failedCount: number
}

interface CenterColumnProps {
  stats: {
    active: number
    queued: number
    blocked: number
    failed: number
    actualFailed: number
    review: number
    done: number
  }
  partitions: {
    todo: unknown[]
    inProgress: unknown[]
    awaitingReview: unknown[]
    done: unknown[]
    blocked: unknown[]
    failed: unknown[]
  }
  chartData: ChartBar[]
  burndownData: ChartBar[]
  cardErrors: Record<string, string | undefined>
  successRate: number | null
  avgDuration: number | null
  avgTaskDuration: number | null
  taskDurationCount: number
  localAgents: LocalAgent[]
  successTrendData: DailySuccessRate[]
  onFilterClick: (filter: StatusFilter) => void
}

/** Center column with attention card, pipeline, and charts. */
export function CenterColumn({
  stats,
  partitions,
  chartData,
  burndownData,
  cardErrors,
  successRate,
  avgDuration,
  avgTaskDuration,
  taskDurationCount,
  localAgents,
  successTrendData,
  onFilterClick
}: CenterColumnProps): React.JSX.Element {
  return (
    <div className="dashboard-col dashboard-col--center">
      {(stats.failed > 0 || partitions.awaitingReview.length > 0 || stats.blocked > 0) && (
        <NeonCard accent="red" title="Attention">
          {stats.failed > 0 && (
            <button className="dashboard-attention-item" onClick={() => onFilterClick('failed')}>
              <XCircle size={12} />
              <span>
                {stats.failed} failed task{stats.failed !== 1 ? 's' : ''}
              </span>
            </button>
          )}
          {partitions.awaitingReview.length > 0 && (
            <div className="dashboard-attention-review-section">
              <button
                className="dashboard-attention-item"
                onClick={() => onFilterClick('awaiting-review')}
              >
                <GitPullRequest size={12} />
                <span>
                  {partitions.awaitingReview.length} PR
                  {partitions.awaitingReview.length !== 1 ? 's' : ''} awaiting review
                </span>
              </button>
              <button
                className="dashboard-review-cta"
                onClick={() => onFilterClick('awaiting-review')}
              >
                Review Code
              </button>
            </div>
          )}
          {stats.blocked > 0 && (
            <button className="dashboard-attention-item" onClick={() => onFilterClick('blocked')}>
              <AlertTriangle size={12} />
              <span>
                {stats.blocked} blocked task{stats.blocked !== 1 ? 's' : ''}
              </span>
            </button>
          )}
        </NeonCard>
      )}

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
          onStageClick={onFilterClick}
        />
      </NeonCard>

      <ChartsSection
        chartData={chartData}
        burndownData={burndownData}
        cardErrors={cardErrors}
        successRate={successRate}
        stats={{ done: stats.done, failed: stats.failed, actualFailed: stats.actualFailed }}
        avgDuration={avgDuration}
        avgTaskDuration={avgTaskDuration}
        taskDurationCount={taskDurationCount}
        localAgents={localAgents}
        successTrendData={successTrendData}
      />
    </div>
  )
}
