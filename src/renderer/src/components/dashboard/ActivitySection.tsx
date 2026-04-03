import { NeonCard, ActivityFeed, MiniChart, type ChartBar } from '../neon'
import { neonVar } from '../neon/types'
import { useDashboardDataStore } from '../../stores/dashboardData'
import { timeAgo } from '../../lib/format'
import { CheckCircle, TrendingUp, DollarSign } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'
import type { FeedEvent } from '../neon/ActivityFeed'

interface ActivitySectionProps {
  feedEvents: FeedEvent[]
  cardErrors: Record<string, string | undefined>
  recentCompletions: SprintTask[]
  costTrendData: ChartBar[]
  costAvg: string | null
  cost24h: number
  onFeedEventClick: () => void
  onCompletionClick: () => void
}

/** Right column with activity feed, recent completions, and cost metrics. */
export function ActivitySection({
  feedEvents,
  cardErrors,
  recentCompletions,
  costTrendData,
  costAvg,
  cost24h,
  onFeedEventClick,
  onCompletionClick
}: ActivitySectionProps): React.JSX.Element {
  return (
    <div className="dashboard-col">
      <NeonCard accent="blue" title="Feed" style={{ flex: 1, minHeight: 0 }}>
        {cardErrors.feed ? (
          <div className="dashboard-card-error">
            <div className="dashboard-card-error__message">{cardErrors.feed}</div>
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
            recentCompletions.map((t) => (
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
                <span className="dashboard-completion-time">{timeAgo(t.completed_at!)}</span>
              </div>
            ))
          )}
        </div>
      </NeonCard>

      <NeonCard accent="orange" title="Cost / Run" icon={<TrendingUp size={12} />}>
        <MiniChart data={costTrendData} height={80} />
        <div className="dashboard-chart-caption">
          {costTrendData.length} runs{costAvg && ` · avg $${costAvg}`}
        </div>
      </NeonCard>

      <NeonCard accent="orange" title="Cost 24h" icon={<DollarSign size={12} />}>
        <div className="dashboard-cost-value">${cost24h.toFixed(2)}</div>
      </NeonCard>
    </div>
  )
}
