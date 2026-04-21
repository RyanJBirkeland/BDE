import { neonVar } from './types'
import type { FeedEvent } from '../../lib/dashboard-types'

export type { FeedEvent }

interface ActivityFeedProps {
  events: FeedEvent[]
  maxItems?: number | undefined
  onEventClick?: ((event: FeedEvent) => void) | undefined
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 1) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function ActivityFeed({
  events,
  maxItems,
  onEventClick
}: ActivityFeedProps): React.JSX.Element {
  const displayed = maxItems ? events.slice(0, maxItems) : events

  if (displayed.length === 0) {
    return <div className="activity-feed__empty">No recent activity</div>
  }

  return (
    <div className="activity-feed">
      {displayed.map((event) => (
        <div
          key={event.id}
          className={`activity-feed__item ${onEventClick ? 'activity-feed__item--clickable' : ''}`}
          onClick={onEventClick ? () => onEventClick(event) : undefined}
          onKeyDown={
            onEventClick
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onEventClick(event)
                  }
                }
              : undefined
          }
          role={onEventClick ? 'button' : undefined}
          tabIndex={onEventClick ? 0 : undefined}
        >
          <div
            className="activity-feed__dot"
            style={{
              background: neonVar(event.accent, 'color')
            }}
          />
          <span className="activity-feed__label">{event.label}</span>
          <span className="activity-feed__timestamp">{formatRelativeTime(event.timestamp)}</span>
        </div>
      ))}
    </div>
  )
}
