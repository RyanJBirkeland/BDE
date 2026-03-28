import { useCallback, useEffect, useRef, useState } from 'react'
import type { SprintTask } from '../../../../shared/types'
import { useSprintTasks } from '../../stores/sprintTasks'

const MIN_DRAWER_WIDTH = 280
const MAX_DRAWER_WIDTH = 700
const DEFAULT_DRAWER_WIDTH = 380

export interface TaskDetailDrawerProps {
  task: SprintTask
  onClose: () => void
  onLaunch: (task: SprintTask) => void
  onStop: (task: SprintTask) => void
  onMarkDone: (task: SprintTask) => void
  onRerun: (task: SprintTask) => void
  onDelete: (task: SprintTask) => void
  onViewLogs: (task: SprintTask) => void
  onOpenSpec: () => void
  onEdit: (task: SprintTask) => void
  onViewAgents: (agentId: string) => void
}

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getDotColor(status: string): string {
  switch (status) {
    case 'queued':
      return 'var(--neon-cyan)'
    case 'blocked':
      return 'var(--neon-orange)'
    case 'active':
      return 'var(--neon-purple)'
    case 'done':
      return 'var(--neon-pink)'
    case 'failed':
    case 'error':
    case 'cancelled':
      return 'var(--neon-red, #ff3366)'
    default:
      return 'var(--neon-cyan)'
  }
}

function getDependencyStats(
  deps: SprintTask['depends_on'],
  allTasks: SprintTask[]
): { count: number; complete: number } | null {
  if (!deps || deps.length === 0) return null
  const depIds = new Set(deps.map((d) => d.id))
  const complete = allTasks.filter((t) => depIds.has(t.id) && t.status === 'done').length
  return { count: deps.length, complete }
}

export function TaskDetailDrawer({
  task,
  onClose,
  onLaunch,
  onStop,
  onMarkDone,
  onRerun,
  onDelete,
  onViewLogs,
  onOpenSpec,
  onEdit,
  onViewAgents
}: TaskDetailDrawerProps) {
  const [elapsed, setElapsed] = useState('')
  const [width, setWidth] = useState(DEFAULT_DRAWER_WIDTH)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(DEFAULT_DRAWER_WIDTH)

  useEffect(() => {
    if (task.status !== 'active' || !task.started_at) return
    setElapsed(formatElapsed(task.started_at))
    const interval = setInterval(() => setElapsed(formatElapsed(task.started_at!)), 10000)
    return () => clearInterval(interval)
  }, [task.status, task.started_at])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = width
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent): void => {
      if (!dragging.current) return
      const delta = startX.current - ev.clientX
      const next = Math.min(MAX_DRAWER_WIDTH, Math.max(MIN_DRAWER_WIDTH, startWidth.current + delta))
      setWidth(next)
    }

    const onUp = (): void => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width])

  const allTasks = useSprintTasks((s) => s.tasks)
  const depStats = getDependencyStats(task.depends_on, allTasks)

  return (
    <aside className="task-drawer" data-testid="task-detail-drawer" style={{ width }}>
      {/* Resize handle */}
      <div className="task-drawer__resize-handle" onMouseDown={handleResizeStart} />
      {/* Header */}
      <div className="task-drawer__head">
        <h2 className="task-drawer__title">{task.title}</h2>
        <div className="task-drawer__status">
          <span
            className="task-drawer__status-dot"
            style={{ background: getDotColor(task.status) }}
          />
          <span>{task.status}</span>
          {elapsed && <span> — {elapsed}</span>}
        </div>
        <button className="task-drawer__close" onClick={onClose} aria-label="Close drawer">
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="task-drawer__body">
        <div className="task-drawer__field">
          <span className="task-drawer__label">Repo</span>
          <span className="task-drawer__value">{task.repo}</span>
        </div>

        <div className="task-drawer__field">
          <span className="task-drawer__label">Priority</span>
          <span className="task-drawer__value">P{task.priority}</span>
        </div>

        {depStats && (
          <div className="task-drawer__field">
            <span className="task-drawer__label">Dependencies</span>
            <span className="task-drawer__value">
              {depStats.count} dep{depStats.count !== 1 ? 's' : ''} — {depStats.complete}/
              {depStats.count} complete
            </span>
          </div>
        )}

        <div className="task-drawer__field">
          <span className="task-drawer__label">Created</span>
          <span className="task-drawer__value">{formatTimestamp(task.created_at)}</span>
        </div>

        {task.started_at && (
          <div className="task-drawer__field">
            <span className="task-drawer__label">Started</span>
            <span className="task-drawer__value">{formatTimestamp(task.started_at)}</span>
          </div>
        )}

        {/* Prompt block */}
        {task.prompt && (
          <>
            <span className="task-drawer__prompt-label">Prompt</span>
            <div className="task-drawer__prompt">{task.prompt}</div>
          </>
        )}

        {/* Spec link */}
        {task.spec && (
          <button className="task-drawer__spec-link" onClick={onOpenSpec}>
            View Spec →
          </button>
        )}

        {/* Agent section */}
        {task.agent_run_id && (
          <button
            className="task-drawer__agent-link"
            onClick={() => onViewAgents(task.agent_run_id!)}
          >
            ● Running — View in Agents →
          </button>
        )}

        {/* PR section */}
        {task.pr_url && task.pr_number && (
          <div className="task-drawer__field">
            <span className="task-drawer__label">PR</span>
            <span className="task-drawer__value">
              #{task.pr_number} ({task.pr_status ?? 'unknown'})
            </span>
          </div>
        )}

        {/* Branch-only: PR creation failed */}
        {task.pr_status === 'branch_only' && (
          <div className="task-drawer__branch-only" data-testid="branch-only-section">
            <span className="task-drawer__label">Branch pushed</span>
            <span className="task-drawer__value task-drawer__value--warning">
              PR creation failed after retries
            </span>
            {task.notes && (() => {
              const match = task.notes.match(/Branch\s+(\S+)\s+pushed\s+to\s+(\S+)/)
              if (!match) return null
              const [, branch, ghRepo] = match
              return (
                <a
                  className="task-drawer__btn task-drawer__btn--primary"
                  href={`https://github.com/${ghRepo}/pull/new/${branch}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginTop: '8px', display: 'inline-block' }}
                >
                  Create PR →
                </a>
              )
            })()}
          </div>
        )}
      </div>

      {/* Actions bar */}
      <div className="task-drawer__actions">
        <ActionButtons
          task={task}
          onLaunch={onLaunch}
          onStop={onStop}
          onMarkDone={onMarkDone}
          onRerun={onRerun}
          onDelete={onDelete}
          onViewLogs={onViewLogs}
          onEdit={onEdit}
        />
      </div>
    </aside>
  )
}

function ActionButtons({
  task,
  onLaunch,
  onStop,
  onMarkDone: _onMarkDone,
  onRerun,
  onDelete,
  onViewLogs,
  onEdit
}: {
  task: SprintTask
  onLaunch: (t: SprintTask) => void
  onStop: (t: SprintTask) => void
  onMarkDone: (t: SprintTask) => void
  onRerun: (t: SprintTask) => void
  onDelete: (t: SprintTask) => void
  onViewLogs: (t: SprintTask) => void
  onEdit: (t: SprintTask) => void
}) {
  switch (task.status) {
    case 'backlog':
      return (
        <>
          <button
            className="task-drawer__btn task-drawer__btn--primary"
            onClick={() => onLaunch(task)}
          >
            Launch
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => onEdit(task)}
          >
            Edit
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--danger"
            onClick={() => onDelete(task)}
          >
            Delete
          </button>
        </>
      )
    case 'queued':
      return (
        <>
          <button
            className="task-drawer__btn task-drawer__btn--primary"
            onClick={() => onLaunch(task)}
          >
            Launch
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => onEdit(task)}
          >
            Edit
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--danger"
            onClick={() => onDelete(task)}
          >
            Delete
          </button>
        </>
      )
    case 'blocked':
      return (
        <>
          <button
            className="task-drawer__btn task-drawer__btn--primary"
            onClick={() => onLaunch(task)}
          >
            Unblock
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => onEdit(task)}
          >
            Edit
          </button>
        </>
      )
    case 'active':
      return (
        <>
          <button
            className="task-drawer__btn task-drawer__btn--primary"
            onClick={() => onViewLogs(task)}
          >
            View Logs
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => onEdit(task)}
          >
            Edit
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--danger"
            onClick={() => onStop(task)}
          >
            Stop
          </button>
        </>
      )
    case 'done':
      return (
        <>
          {task.pr_url && (
            <a
              className="task-drawer__btn task-drawer__btn--primary"
              href={task.pr_url}
              target="_blank"
              rel="noreferrer"
            >
              View PR
            </a>
          )}
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => onRerun(task)}
          >
            Re-run
          </button>
        </>
      )
    case 'failed':
    case 'error':
    case 'cancelled':
      return (
        <>
          <button
            className="task-drawer__btn task-drawer__btn--primary"
            onClick={() => onRerun(task)}
          >
            Re-run
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => onEdit(task)}
          >
            Edit
          </button>
          <button
            className="task-drawer__btn task-drawer__btn--danger"
            onClick={() => onDelete(task)}
          >
            Delete
          </button>
        </>
      )
    default:
      return <></>
  }
}
