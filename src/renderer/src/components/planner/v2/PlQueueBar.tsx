import { useMemo } from 'react'
import type { SprintTask } from '../../../../../shared/types'

interface PlQueueBarProps {
  tasks: SprintTask[]
  isPaused: boolean
  onQueueAll: () => void
  onTogglePause: () => void
}

export function PlQueueBar({
  tasks,
  isPaused,
  onQueueAll,
  onTogglePause
}: PlQueueBarProps): React.JSX.Element {
  const { readyCount, needsSpecCount } = useMemo(() => {
    let ready = 0
    let needsSpec = 0
    tasks.forEach((t) => {
      const hasSpec = !!t.spec && t.spec.trim() !== ''
      if (!hasSpec) needsSpec++
      else if (t.status === 'backlog' || t.status === 'queued') ready++
    })
    return { readyCount: ready, needsSpecCount: needsSpec }
  }, [tasks])
  const canQueue = readyCount > 0 && needsSpecCount === 0

  return (
    <div
      style={{
        height: 48,
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderTop: '1px solid var(--line)',
        background: 'var(--surf-1)',
        flexShrink: 0
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--fg)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{readyCount}</span> ready
        to queue
      </span>

      {needsSpecCount > 0 && (
        <>
          <span style={{ width: 3, height: 3, background: 'var(--fg-4)', borderRadius: 2 }} />
          <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--st-blocked)' }}>
              {needsSpecCount}
            </span>{' '}
            need specs
          </span>
        </>
      )}

      <span style={{ flex: 1 }} />

      <button
        onClick={onTogglePause}
        style={{
          height: 28,
          padding: '0 12px',
          borderRadius: 6,
          background: 'transparent',
          border: '1px solid var(--line)',
          color: 'var(--fg-2)',
          fontSize: 12,
          cursor: 'pointer'
        }}
      >
        {isPaused ? 'Resume epic' : 'Pause epic'}
      </button>

      <button
        onClick={onQueueAll}
        disabled={!canQueue}
        style={{
          height: 28,
          padding: '0 14px',
          borderRadius: 6,
          background: canQueue ? 'var(--accent)' : 'var(--surf-2)',
          color: canQueue ? 'var(--accent-fg)' : 'var(--fg-4)',
          border: 'none',
          fontSize: 12,
          fontWeight: 500,
          cursor: canQueue ? 'pointer' : 'not-allowed'
        }}
      >
        Send to pipeline →
      </button>
    </div>
  )
}
