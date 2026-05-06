import type { SprintTask, AgentEventType } from '../../../../../shared/types'
import { usePlActivityFeed, type FeedEntry } from './hooks/usePlActivityFeed'
import { timeAgo } from '../../../lib/format'

interface PlActivityFeedProps {
  tasks: SprintTask[]
}

const DOT_COLOR: Partial<Record<AgentEventType | 'change', string>> = {
  'agent:started': 'var(--st-running)',
  'agent:completed': 'var(--st-done)',
  'agent:error': 'var(--st-failed)',
  'agent:tool_call': 'var(--fg-4)',
  change: 'var(--fg-3)'
}

function entryColor(entry: FeedEntry): string {
  const key = entry.kind === 'agent' ? entry.eventType : 'change'
  return DOT_COLOR[key] ?? 'var(--fg-4)'
}

function entryDescription(entry: FeedEntry): string {
  if (entry.kind === 'agent') return entry.summary
  if (entry.field === 'status') return `status → ${entry.newValue ?? '?'}`
  return `${entry.field} updated`
}

export function PlActivityFeed({ tasks }: PlActivityFeedProps): React.JSX.Element {
  const { entries, loading, error, reload } = usePlActivityFeed(tasks)

  if (loading) {
    return (
      <div style={centeredStyle}>
        <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>Loading…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div style={centeredStyle}>
        <span style={{ fontSize: 12, color: 'var(--st-failed)' }}>{error}</span>
        <button
          onClick={reload}
          style={{
            marginTop: 8,
            fontSize: 12,
            color: 'var(--fg-2)',
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 4,
            padding: '2px 10px',
            cursor: 'pointer'
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div style={centeredStyle}>
        <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>
          No activity yet for tasks in this epic.
        </span>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 28px' }}>
      {entries.map((entry, i) => (
        <FeedRow key={`${entry.taskId}-${entry.timestamp}-${i}`} entry={entry} />
      ))}
    </div>
  )
}

function FeedRow({ entry }: { entry: FeedEntry }): React.JSX.Element {
  const color = entryColor(entry)
  const description = entryDescription(entry)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '7px 0',
        borderBottom: '1px solid var(--line)'
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          marginTop: 5
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--fg-3)',
            marginRight: 6
          }}
        >
          {entry.taskTitle}
        </span>
        <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{description}</span>
      </div>
      <span
        style={{
          fontSize: 11,
          color: 'var(--fg-4)',
          fontFamily: 'var(--font-mono)',
          flexShrink: 0
        }}
      >
        {timeAgo(entry.timestamp)}
      </span>
    </div>
  )
}

const centeredStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center'
}
