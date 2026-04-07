import { NeonCard, ActivityFeed, MiniChart, type ChartBar } from '../neon'
import { useDashboardDataStore } from '../../stores/dashboardData'
import { timeAgo, formatTokens } from '../../lib/format'
import { CheckCircle, TrendingUp, Gauge } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'
import type { FeedEvent } from '../neon/ActivityFeed'
import { FailureBreakdown } from './FailureBreakdown'
import { SpecTypeSuccessRate } from './SpecTypeSuccessRate'

interface ActivitySectionProps {
  feedEvents: FeedEvent[]
  cardErrors: Record<string, string | undefined>
  recentCompletions: SprintTask[]
  tokenTrendData: ChartBar[]
  tokenAvg: string | null
  tokens24h: number
  taskTokenMap: Map<string, number>
  onFeedEventClick: () => void
  onCompletionClick: () => void
}

/** Right column with activity feed, recent completions, and token usage metrics. */
export function ActivitySection({
  feedEvents,
  cardErrors,
  recentCompletions,
  tokenTrendData,
  tokenAvg,
  tokens24h,
  taskTokenMap,
  onFeedEventClick,
  onCompletionClick
}: ActivitySectionProps): React.JSX.Element {
  return (
    <div className="dashboard-col">
      <NeonCard accent="blue" title="Feed" className="dashboard-feed-card">
        {cardErrors.feed ? (
          <div className="dashboard-card-error">
            <div className="dashboard-card-error__message">{cardErrors.feed}</div>
            <button
              className="dashboard-card-error__retry"
              onClick={() => useDashboardDataStore.getState().fetchAll()}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="dashboard-feed-scroll">
            <ActivityFeed events={feedEvents} onEventClick={onFeedEventClick} />
          </div>
        )}
      </NeonCard>

      <NeonCard accent="cyan" title="Recent Completions" icon={<CheckCircle size={12} />}>
        <div className="dashboard-completions-list">
          {recentCompletions.length === 0 ? (
            <div className="dashboard-completions-empty">No completions yet</div>
          ) : (
            recentCompletions.map((t) => {
              const tokens = taskTokenMap.get(t.id)
              return (
                <div
                  key={t.id}
                  className="dashboard-completion-row"
                  role="button"
                  tabIndex={0}
                  onClick={onCompletionClick}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onCompletionClick()
                    }
                  }}
                >
                  <span className="dashboard-completion-title">{t.title}</span>
                  <div className="dashboard-completion-meta">
                    {tokens != null && (
                      <span className="dashboard-completion-cost">{formatTokens(tokens)}</span>
                    )}
                    <span className="dashboard-completion-time">{timeAgo(t.completed_at!)}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </NeonCard>

      <FailureBreakdown />

      <SpecTypeSuccessRate />

      <NeonCard accent="cyan" title="Tokens / Run" icon={<TrendingUp size={12} />}>
        <MiniChart data={tokenTrendData} height={80} />
        <div className="dashboard-chart-caption">
          {tokenTrendData.length} runs{tokenAvg && ` · avg ${tokenAvg}`}
        </div>
      </NeonCard>

      <NeonCard accent="cyan" title="Tokens 24h" icon={<Gauge size={12} />}>
        <div className="dashboard-cost-value">{formatTokens(tokens24h)}</div>
      </NeonCard>
    </div>
  )
}
