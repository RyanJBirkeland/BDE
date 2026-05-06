import type { SprintTask } from '../../../../../shared/types'

interface PlTaskListPaneProps {
  tasks: SprintTask[]
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
  onAddTask: () => void
}

const DOT_CLASS: Partial<Record<string, string>> = {
  done: 'done',
  active: 'running',
  queued: 'queued',
  blocked: 'blocked',
  review: 'review',
  approved: 'review',
  failed: 'failed',
  error: 'failed',
  cancelled: 'failed',
  backlog: 'queued'
}

export function PlTaskListPane({
  tasks,
  selectedTaskId,
  onSelectTask,
  onAddTask
}: PlTaskListPaneProps): React.JSX.Element {
  return (
    <div
      style={{
        width: 380,
        minWidth: 380,
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div
        style={{
          height: 32,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--line)',
          flexShrink: 0
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: 'var(--fg-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em'
          }}
        >
          Tasks
        </span>
        <span style={{ fontSize: 10, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
          {tasks.length}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={onAddTask}
          style={{
            height: 22,
            padding: '0 8px',
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 4,
            fontSize: 10,
            color: 'var(--fg-2)',
            cursor: 'pointer'
          }}
        >
          + Task
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '6px 8px' }}>
        {tasks.map((task, i) => (
          <PlTaskRow
            key={task.id}
            task={task}
            index={i + 1}
            selected={task.id === selectedTaskId}
            onSelect={onSelectTask}
          />
        ))}
        {tasks.length === 0 && (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--fg-4)'
            }}
          >
            No tasks yet
          </div>
        )}
      </div>
    </div>
  )
}

function PlTaskRow({
  task,
  index,
  selected,
  onSelect
}: {
  task: SprintTask
  index: number
  selected: boolean
  onSelect: (id: string) => void
}): React.JSX.Element {
  const dotClass = DOT_CLASS[task.status] ?? 'queued'
  const needsSpec = !task.spec || task.spec.trim() === ''
  const priorityLabel = `P${task.priority}`
  const firstHardDep = task.depends_on?.find((d) => d.type === 'hard')

  return (
    <button
      onClick={() => onSelect(task.id)}
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        background: selected ? 'var(--surf-2)' : 'transparent',
        border: '1px solid ' + (selected ? 'var(--line-2)' : 'transparent'),
        borderRadius: 6,
        cursor: 'pointer',
        marginBottom: 2
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          color: 'var(--fg-4)',
          width: 18,
          textAlign: 'right',
          flexShrink: 0
        }}
      >
        {String(index).padStart(2, '0')}
      </span>

      <span className={`fleet-dot fleet-dot--${dotClass}`} />

      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          color: 'var(--fg)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {task.title}
      </span>

      {needsSpec && (
        <span
          style={{
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            color: 'var(--st-blocked)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            flexShrink: 0
          }}
        >
          needs spec
        </span>
      )}

      {firstHardDep && (
        <span
          style={{
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            color: 'var(--fg-3)',
            border: '1px solid var(--line-2)',
            borderRadius: 3,
            padding: '1px 4px',
            flexShrink: 0
          }}
        >
          ← {firstHardDep.id.slice(0, 8)}
        </span>
      )}

      <span
        style={{
          fontSize: 9,
          color: 'var(--fg-4)',
          fontFamily: 'var(--font-mono)',
          flexShrink: 0
        }}
      >
        {priorityLabel}
      </span>
    </button>
  )
}
