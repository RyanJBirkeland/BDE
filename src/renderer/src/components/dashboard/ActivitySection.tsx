import { memo } from 'react'
import { NeonCard, ActivityFeed, MiniChart } from '../neon'
import type { ChartBar } from '../../lib/dashboard-types'
import { DashboardErrorCard } from './DashboardErrorCard'
import { timeAgo, formatTokens } from '../../lib/format'
import { CheckCircle, TrendingUp, Gauge } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'
import type { FeedEvent } from '../../lib/dashboard-types'
import './ActivitySection.css'

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
  onRetry: () => void
}

/** Right column with activity feed, recent completions, and token usage metrics. */
function ActivitySectionInner({
  feedEvents,
  cardErrors,
  recentCompletions,
  tokenTrendData,
  tokenAvg,
  tokens24h,
  taskTokenMap,
  onFeedEventClick,
  onCompletionClick,
  onRetry
}: ActivitySectionProps): React.JSX.Element {
  return (
    <div className="dashboard-col">
      <NeonCard accent="blue" title="Feed" className="dashboard-feed-card">
        {cardErrors.feed ? (
          <DashboardErrorCard message={cardErrors.feed} onRetry={onRetry} />
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

export const ActivitySection = memo(ActivitySectionInner)
