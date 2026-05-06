import { useMemo, useState, useRef, useEffect } from 'react'
import type { TaskGroup, SprintTask } from '../../../../../shared/types'
import { useTaskGroups } from '../../../stores/taskGroups'
import { EpicIcon } from './PlEpicRail'
import { partitionSprintTasks } from '../../../lib/partitionSprintTasks'

interface Props {
  epic: TaskGroup
  tasks: SprintTask[]
  onToggleReady: () => void
}

const STATUS_LABEL: Record<TaskGroup['status'], string> = {
  ready: 'Ready to queue',
  'in-pipeline': 'In pipeline',
  draft: 'Draft',
  completed: 'Completed'
}

export function PlEpicHero({ epic, tasks, onToggleReady }: Props): React.JSX.Element {
  const { updateGroup } = useTaskGroups()

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

  async function saveName(name: string): Promise<void> {
    const trimmed = name.trim()
    if (trimmed && trimmed !== epic.name) {
      await updateGroup(epic.id, { name: trimmed })
    }
  }

  async function saveGoal(goal: string): Promise<void> {
    const trimmed = goal.trim()
    if (trimmed !== (epic.goal ?? '')) {
      await updateGroup(epic.id, { goal: trimmed || undefined })
    }
  }

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

        <EditableText
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

        <EditableTextarea
          value={epic.goal ?? ''}
          placeholder="Add a goal…"
          onSave={saveGoal}
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

function EditableText({
  value,
  onSave,
  style
}: {
  value: string
  onSave: (v: string) => Promise<void>
  style?: React.CSSProperties
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  function startEdit(): void {
    setDraft(value)
    setEditing(true)
  }

  async function commit(): Promise<void> {
    setEditing(false)
    await onSave(draft)
  }

  function cancel(): void {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        style={{
          ...style,
          display: 'block',
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--accent)',
          outline: 'none',
          padding: '0 0 2px',
          fontFamily: 'inherit'
        }}
      />
    )
  }

  return (
    <div
      onClick={startEdit}
      title="Click to edit"
      style={{
        ...style,
        cursor: 'text',
        borderBottom: '1px solid transparent',
        paddingBottom: 2
      }}
    >
      {value}
    </div>
  )
}

function EditableTextarea({
  value,
  placeholder,
  onSave,
  style
}: {
  value: string
  placeholder?: string
  onSave: (v: string) => Promise<void>
  style?: React.CSSProperties
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [editing, draft])

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  function startEdit(): void {
    setDraft(value)
    setEditing(true)
  }

  async function commit(): Promise<void> {
    setEditing(false)
    await onSave(draft)
  }

  function cancel(): void {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        autoFocus
        onChange={(e) => {
          setDraft(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = `${e.target.scrollHeight}px`
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        style={{
          ...style,
          display: 'block',
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--accent)',
          outline: 'none',
          padding: '0 0 2px',
          fontFamily: 'inherit',
          resize: 'none',
          overflow: 'hidden'
        }}
      />
    )
  }

  return (
    <div
      onClick={startEdit}
      title="Click to edit"
      style={{
        ...style,
        cursor: 'text',
        borderBottom: '1px solid transparent',
        paddingBottom: 2,
        color: value ? style?.color : 'var(--fg-4)'
      }}
    >
      {value || placeholder}
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
