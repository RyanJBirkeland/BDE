import { useState, useEffect, useMemo, useRef } from 'react'
import type { SprintTask } from '../../../../../shared/types'
import { analyzeSpecQuality } from '../../../lib/spec-quality'

interface PlSpecPaneProps {
  tasks: SprintTask[]
  taskId: string | null
  onEditInWorkbench: (task: SprintTask) => void
  onAskAssistantDraft: (message: string) => void
  onSaveSpec: (taskId: string, spec: string) => Promise<void>
}

export function PlSpecPane({
  tasks,
  taskId,
  onEditInWorkbench,
  onAskAssistantDraft,
  onSaveSpec
}: PlSpecPaneProps): React.JSX.Element {
  const task = taskId ? tasks.find((t) => t.id === taskId) : null

  if (!task) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>Select a task to view its spec</span>
      </div>
    )
  }

  return (
    <PlSpecPaneInner
      key={task.id}
      task={task}
      onEditInWorkbench={onEditInWorkbench}
      onAskAssistantDraft={onAskAssistantDraft}
      onSaveSpec={onSaveSpec}
    />
  )
}

function PlSpecPaneInner({
  task,
  onEditInWorkbench,
  onAskAssistantDraft,
  onSaveSpec
}: {
  task: SprintTask
  onEditInWorkbench: (task: SprintTask) => void
  onAskAssistantDraft: (message: string) => void
  onSaveSpec: (taskId: string, spec: string) => Promise<void>
}): React.JSX.Element {
  const needsSpec = !task.spec || task.spec.trim() === ''

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <PlSpecPaneHeader task={task} onEditInWorkbench={onEditInWorkbench} />
      {needsSpec ? (
        <PlSpecEmptyState
          task={task}
          onAskAssistantDraft={onAskAssistantDraft}
          onEditInWorkbench={onEditInWorkbench}
        />
      ) : (
        <PlSpecEditor task={task} onSaveSpec={onSaveSpec} />
      )}
    </div>
  )
}

function PlSpecPaneHeader({
  task,
  onEditInWorkbench
}: {
  task: SprintTask
  onEditInWorkbench: (t: SprintTask) => void
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '14px 24px 12px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: 'var(--fg-3)',
          fontFamily: 'var(--font-mono)',
          flexShrink: 0
        }}
      >
        {task.id.slice(0, 8)}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--fg)',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {task.title}
      </span>
      <span
        style={{
          fontSize: 11,
          color: 'var(--fg-2)',
          fontFamily: 'var(--font-mono)',
          background: 'var(--surf-1)',
          border: '1px solid var(--line)',
          borderRadius: 999,
          padding: '0 8px',
          height: 20,
          display: 'inline-flex',
          alignItems: 'center',
          flexShrink: 0
        }}
      >
        {task.repo}
      </span>
      <button
        onClick={() => onEditInWorkbench(task)}
        style={{
          height: 26,
          padding: '0 10px',
          borderRadius: 5,
          flexShrink: 0,
          background: 'transparent',
          border: '1px solid var(--line)',
          fontSize: 11,
          color: 'var(--fg-2)',
          cursor: 'pointer'
        }}
      >
        Open in workbench
      </button>
    </div>
  )
}

function PlSpecEmptyState({
  task,
  onAskAssistantDraft,
  onEditInWorkbench
}: {
  task: SprintTask
  onAskAssistantDraft: (message: string) => void
  onEditInWorkbench: (t: SprintTask) => void
}): React.JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 14
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: 'var(--surf-1)',
          border: '1px dashed var(--line-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--fg-3)',
          fontSize: 20
        }}
      >
        +
      </div>

      <div style={{ fontSize: 14, color: 'var(--fg)', fontWeight: 500 }}>No spec yet</div>

      <div
        style={{
          fontSize: 12,
          color: 'var(--fg-3)',
          textAlign: 'center',
          maxWidth: 360,
          lineHeight: 1.5
        }}
      >
        A spec describes what the agent should build, in implementation-ready language. Draft one
        yourself, or ask the assistant to propose one based on this epic&apos;s goal.
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button
          onClick={() => onAskAssistantDraft(`Draft a spec for this task: "${task.title}"`)}
          style={{
            height: 30,
            padding: '0 14px',
            borderRadius: 6,
            background: 'var(--accent)',
            color: 'var(--accent-fg)',
            border: 'none',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          Ask assistant to draft
        </button>
        <button
          onClick={() => onEditInWorkbench(task)}
          style={{
            height: 30,
            padding: '0 14px',
            borderRadius: 6,
            background: 'transparent',
            color: 'var(--fg-2)',
            border: '1px solid var(--line)',
            fontSize: 12,
            cursor: 'pointer'
          }}
        >
          Write manually
        </button>
      </div>

      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          color: 'var(--fg-4)',
          fontFamily: 'var(--font-mono)'
        }}
      >
        Templates: Bug fix · Feature · Refactor · Test coverage
      </div>
    </div>
  )
}

function PlSpecEditor({
  task,
  onSaveSpec
}: {
  task: SprintTask
  onSaveSpec: (taskId: string, spec: string) => Promise<void>
}): React.JSX.Element {
  const [draftSpec, setDraftSpec] = useState(task.spec ?? '')
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDraftSpec(task.spec ?? '')
  }, [task.spec])

  const saveSpec = async (spec: string): Promise<void> => {
    if (spec === task.spec) return
    setSaving(true)
    try {
      await onSaveSpec(task.id, spec)
      setLastSaved(new Date())
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (value: string): void => {
    setDraftSpec(value)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => void saveSpec(value), 2000)
  }

  const handleBlur = (): void => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    void saveSpec(draftSpec)
  }

  const quality = useMemo(() => analyzeSpecQuality(draftSpec), [draftSpec])

  const savedLabel = saving
    ? 'saving…'
    : lastSaved
      ? `auto-saved · ${formatRelativeTime(lastSaved)}`
      : 'auto-save on pause'

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          height: 32,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          borderBottom: '1px solid var(--line)',
          flexShrink: 0
        }}
      >
        <SpecQualityPill ok={quality.hasFilesToChange} label="Files to change" />
        <SpecQualityPill ok={quality.hasHowToTest} label="How to test" />
        <SpecQualityPill ok={quality.hasAcceptanceCriteria} label="Acceptance criteria" />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
          {savedLabel}
        </span>
      </div>

      <textarea
        value={draftSpec}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        aria-label="Task specification"
        style={{
          flex: 1,
          padding: '20px 28px',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
          color: 'var(--fg-2)',
          lineHeight: 1.7
        }}
        placeholder="Write a spec for this task…"
        spellCheck={false}
      />
    </div>
  )
}

function SpecQualityPill({ ok, label }: { ok: boolean; label: string }): React.JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: ok ? 'var(--st-done)' : 'var(--st-blocked)',
          opacity: ok ? 1 : 0.7
        }}
      />
      <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>{label}</span>
      <span className="sr-only">{ok ? 'satisfied' : 'not satisfied'}</span>
    </span>
  )
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}
