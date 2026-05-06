import { useMemo } from 'react'
import type { TaskGroup, SprintTask } from '../../../../../shared/types'
import { EpicIcon } from './PlEpicRail'
import { EditableField } from './EditableField'
import { partitionSprintTasks } from '../../../lib/partitionSprintTasks'

interface PlEpicHeroProps {
  epic: TaskGroup
  tasks: SprintTask[]
  onToggleReady: () => void
  saveName: (name: string) => Promise<void>
  saveGoal: (goal: string) => Promise<void>
}

const STATUS_LABEL: Record<TaskGroup['status'], string> = {
  ready: 'Ready to queue',
  'in-pipeline': 'In pipeline',
  draft: 'Draft',
  completed: 'Completed'
}

export function PlEpicHero({
  epic,
  tasks,
  onToggleReady,
  saveName,
  saveGoal
}: PlEpicHeroProps): React.JSX.Element {
  const counts = useMemo(() => {
    const c = { done: 0, running: 0, queued: 0, blocked: 0 }
    tasks.forEach((t) => {
      if (t.status === 'done') c.done++
      else if (t.status === 'active') c.running++
      else if (t.status === 'queued') c.queued++
      else if (t.status === 'blocked') c.blocked++
    })
    return c
  }, [tasks])
  const backlogCount = useMemo(() => partitionSprintTasks(tasks).backlog.length, [tasks])
  const { done: doneCount, running: runningCount, queued: queuedCount, blocked: blockedCount } =
    counts

  return (
    <div
      style={{
        padding: '20px 28px 18px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
        flexShrink: 0
      }}
    >
      <EpicIcon icon={epic.icon} accent={epic.accent_color} size={44} fontSize={18} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
            {epic.id}
          </span>
          <span style={{ width: 3, height: 3, background: 'var(--fg-4)', borderRadius: 2 }} />
          <span
            style={{
              fontSize: 11,
              color: 'var(--fg-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em'
            }}
          >
            {STATUS_LABEL[epic.status]}
          </span>
          {epic.is_paused && (
            <>
              <span style={{ width: 3, height: 3, background: 'var(--fg-4)', borderRadius: 2 }} />
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--st-blocked)',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                paused
              </span>
            </>
          )}
        </div>

        <EditableField
          value={epic.name}
          onSave={saveName}
          style={{
            marginTop: 4,
            fontSize: 22,
            fontWeight: 500,
            color: 'var(--fg)',
            letterSpacing: '-0.01em'
          }}
        />

        <EditableField
          value={epic.goal ?? ''}
          onSave={saveGoal}
          multiline
          placeholder="Add a goal…"
          style={{
            marginTop: 6,
            fontSize: 13,
            color: 'var(--fg-2)',
            lineHeight: 1.5,
            maxWidth: 720
          }}
        />

        <div style={{ marginTop: 14, display: 'flex', gap: 18, alignItems: 'center' }}>
          <ProgressDot label="done" count={doneCount} dotClass="done" />
          <ProgressDot label="running" count={runningCount} dotClass="running" />
          <ProgressDot label="queued" count={queuedCount} dotClass="queued" />
          <ProgressDot label="blocked" count={blockedCount} dotClass="blocked" />
          <ProgressDot label="backlog" count={backlogCount} dotClass="queued" muted />

          <span style={{ flex: 1 }} />

          <button
            onClick={onToggleReady}
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
            {epic.status === 'ready' ? 'Unmark ready' : 'Mark ready'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProgressDot({
  label,
  count,
  dotClass,
  muted
}: {
  label: string
  count: number
  dotClass: string
  muted?: boolean
}): React.JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        className={`fleet-dot fleet-dot--${dotClass}`}
        style={muted ? { opacity: 0.4 } : undefined}
      />
      <span
        style={{
          fontSize: 12,
          color: 'var(--fg)',
          fontFamily: 'var(--font-mono)',
          fontWeight: 500
        }}
      >
        {count}
      </span>
      <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{label}</span>
    </span>
  )
}
