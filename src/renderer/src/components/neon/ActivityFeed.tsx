import { type NeonAccent, neonVar } from './types'
import { tokens } from '../../design-system/tokens'

export interface FeedEvent {
  id: string
  label: string
  accent: NeonAccent
  timestamp: number
}

interface ActivityFeedProps {
  events: FeedEvent[]
  maxItems?: number
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

export function ActivityFeed({ events, maxItems }: ActivityFeedProps) {
  const displayed = maxItems ? events.slice(0, maxItems) : events

  if (displayed.length === 0) {
    return (
      <div
        style={{
          color: tokens.neon.textDim,
          fontSize: tokens.size.xs,
          padding: `${tokens.space[3]} 0`
        }}
      >
        No recent activity
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
      {displayed.map((event) => (
        <div
          key={event.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[1]
          }}
        >
          <div
            style={{
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              background: neonVar(event.accent, 'color'),
              boxShadow: neonVar(event.accent, 'glow'),
              flexShrink: 0
            }}
          />
          <span
            style={{
              color: tokens.neon.textMuted,
              fontSize: tokens.size.xs,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {event.label}
          </span>
          <span
            style={{
              color: tokens.neon.textDim,
              fontSize: tokens.size.xs,
              flexShrink: 0
            }}
          >
            {formatRelativeTime(event.timestamp)}
          </span>
        </div>
      ))}
    </div>
  )
}
