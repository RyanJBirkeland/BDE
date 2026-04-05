import { NeonCard, SankeyPipeline, type ChartBar } from '../neon'
import { ChartsSection } from './ChartsSection'
import { StatusFilter } from '../../stores/sprintUI'
import { Activity, GitPullRequest, XCircle, AlertTriangle } from 'lucide-react'

interface LocalAgent {
  durationMs?: number | null
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
  cardErrors: Record<string, string | undefined>
  successRate: number | null
  avgDuration: number | null
  localAgents: LocalAgent[]
  onFilterClick: (filter: StatusFilter) => void
  onKeyDownFor: (filter: StatusFilter) => (e: React.KeyboardEvent) => void
}

/** Center column with attention card, pipeline, and charts. */
export function CenterColumn({
  stats,
  partitions,
  chartData,
  cardErrors,
  successRate,
  avgDuration,
  localAgents,
  onFilterClick,
  onKeyDownFor
}: CenterColumnProps): React.JSX.Element {
  return (
    <div className="dashboard-col dashboard-col--center">
      {(stats.failed > 0 || partitions.awaitingReview.length > 0 || stats.blocked > 0) && (
        <NeonCard accent="red" title="Attention">
          {stats.failed > 0 && (
            <div
              className="dashboard-attention-item"
              role="button"
              tabIndex={0}
              onClick={() => onFilterClick('failed')}
              onKeyDown={onKeyDownFor('failed')}
            >
              <XCircle size={12} />
              <span>
                {stats.failed} failed task{stats.failed !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          {partitions.awaitingReview.length > 0 && (
            <div
              className="dashboard-attention-item"
              role="button"
              tabIndex={0}
              onClick={() => onFilterClick('awaiting-review')}
              onKeyDown={onKeyDownFor('awaiting-review')}
            >
              <GitPullRequest size={12} />
              <span>
                {partitions.awaitingReview.length} PR
                {partitions.awaitingReview.length !== 1 ? 's' : ''} awaiting review
              </span>
            </div>
          )}
          {stats.blocked > 0 && (
            <div
              className="dashboard-attention-item"
              role="button"
              tabIndex={0}
              onClick={() => onFilterClick('blocked')}
              onKeyDown={onKeyDownFor('blocked')}
            >
              <AlertTriangle size={12} />
              <span>
                {stats.blocked} blocked task{stats.blocked !== 1 ? 's' : ''}
              </span>
            </div>
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
        cardErrors={cardErrors}
        successRate={successRate}
        stats={{ done: stats.done, failed: stats.failed, actualFailed: stats.actualFailed }}
        avgDuration={avgDuration}
        localAgents={localAgents}
      />
    </div>
  )
}
