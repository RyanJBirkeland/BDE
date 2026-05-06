import { useMemo } from 'react'
import type { TaskGroup, SprintTask } from '../../../../../shared/types'

interface PlPlannerHeaderProps {
  groups: TaskGroup[]
  tasks: SprintTask[]
  assistantOpen: boolean
  onToggleAssistant: () => void
  onNewEpic: () => void
  onImport: () => void
}

export function PlPlannerHeader({
  groups,
  tasks,
  assistantOpen,
  onToggleAssistant,
  onNewEpic,
  onImport
}: PlPlannerHeaderProps): React.JSX.Element {
  const epicCount = groups.length
  const { readyCount, draftCount, inFlightCount } = useMemo(() => {
    let ready = 0
    let draft = 0
    let inFlight = 0
    groups.forEach((g) => {
      if (g.status === 'ready') ready++
      else if (g.status === 'draft') draft++
      else if (g.status === 'in-pipeline') inFlight++
    })
    return { readyCount: ready, draftCount: draft, inFlightCount: inFlight }
  }, [groups])
  const doneTaskCount = useMemo(
    () => tasks.reduce((n, t) => (t.status === 'done' ? n + 1 : n), 0),
    [tasks]
  )

  return (
    <div
      style={{
        height: 60,
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        borderBottom: '1px solid var(--line)',
        flexShrink: 0
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="fleet-eyebrow">Planning workspace</span>
        <span
          style={{ fontSize: 18, fontWeight: 500, color: 'var(--fg)', letterSpacing: '-0.01em' }}
        >
          Planner
        </span>
      </div>

      <span style={{ width: 1, height: 22, background: 'var(--line)', flexShrink: 0 }} />

      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 0 }}>
        <PlHeaderStat label="epics" count={epicCount} dotClass="queued" />
        <PlHeaderStat label="ready" count={readyCount} dotClass="running" />
        <PlHeaderStat label="drafts" count={draftCount} dotClass="queued" />
        <PlHeaderStat label="in flight" count={inFlightCount} dotClass="review" />
        <PlHeaderStat label="done" count={doneTaskCount} dotClass="done" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <PlChip>
          {epicCount} epic{epicCount !== 1 ? 's' : ''} · {tasks.length} tasks
        </PlChip>
        <PlIconButton label="Import" onClick={onImport} />
        <PlIconButton label="Assistant" active={assistantOpen} onClick={onToggleAssistant} />
        <button
          onClick={onNewEpic}
          style={{
            height: 28,
            padding: '0 12px',
            borderRadius: 6,
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            border: 'none',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          + New epic
        </button>
      </div>
    </div>
  )
}

function PlHeaderStat({
  label,
  count,
  dotClass
}: {
  label: string
  count: number
  dotClass: string
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        height: 28,
        padding: '0 10px',
        background: 'transparent',
        borderRadius: 6
      }}
    >
      <span className={`fleet-dot fleet-dot--${dotClass}`} />
      <span
        style={{
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          color: 'var(--fg)',
          fontWeight: 500
        }}
      >
        {count}
      </span>
      <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{label}</span>
    </div>
  )
}

export function PlChip({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span
      style={{
        height: 24,
        padding: '0 10px',
        display: 'inline-flex',
        alignItems: 'center',
        background: 'var(--surf-1)',
        border: '1px solid var(--line)',
        borderRadius: 999,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--fg-2)'
      }}
    >
      {children}
    </span>
  )
}

export function PlIconButton({
  label,
  active,
  onClick
}: {
  label: string
  active?: boolean
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        height: 28,
        padding: '0 10px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: active ? 'var(--surf-2)' : 'transparent',
        border: '1px solid ' + (active ? 'var(--line-2)' : 'var(--line)'),
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 11,
        color: active ? 'var(--fg)' : 'var(--fg-2)'
      }}
    >
      {label}
    </button>
  )
}
