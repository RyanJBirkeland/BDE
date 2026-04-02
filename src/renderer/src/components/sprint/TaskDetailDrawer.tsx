import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { SprintTask } from '../../../../shared/types'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintUI } from '../../stores/sprintUI'
import { formatElapsed, getDotColor } from '../../lib/task-format'

const MIN_DRAWER_WIDTH = 280
const MAX_DRAWER_WIDTH = 700
const DEFAULT_DRAWER_WIDTH = 380

export interface TaskDetailDrawerProps {
  task: SprintTask
  onClose: () => void
  onLaunch: (task: SprintTask) => void
  onStop: (task: SprintTask) => void
  onRerun: (task: SprintTask) => void
  onDelete: (task: SprintTask) => void
  onViewLogs: (task: SprintTask) => void
  onOpenSpec: () => void
  onEdit: (task: SprintTask) => void
  onViewAgents: (agentId: string) => void
  onUnblock?: (task: SprintTask) => void
  onRetry?: (task: SprintTask) => void
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

export function TaskDetailDrawer({
  task,
  onClose,
  onLaunch,
  onStop,
  onRerun,
  onDelete,
  onViewLogs,
  onOpenSpec,
  onEdit,
  onViewAgents,
  onUnblock,
  onRetry
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

  const cleanupRef = useRef<(() => void) | null>(null)

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
      }
    }
  }, [])

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      startX.current = e.clientX
      startWidth.current = width
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMove = (ev: MouseEvent): void => {
        if (!dragging.current) return
        const delta = startX.current - ev.clientX
        const next = Math.min(
          MAX_DRAWER_WIDTH,
          Math.max(MIN_DRAWER_WIDTH, startWidth.current + delta)
        )
        setWidth(next)
      }

      const onUp = (): void => {
        dragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        cleanupRef.current = null
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)

      // Store cleanup function for unmount
      cleanupRef.current = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    },
    [width]
  )

  const depIds = useMemo(
    () => task?.depends_on?.map((d) => d.id) ?? [],
    [task?.depends_on]
  )
  const allTasks = useSprintTasks((s) => s.tasks)
  const depTasks = useMemo(
    () =>
      depIds.length === 0
        ? []
        : allTasks.filter((t) => depIds.includes(t.id)),
    [depIds, allTasks]
  )
  const setSelectedTaskId = useSprintUI((s) => s.setSelectedTaskId)

  return (
    <aside className="task-drawer" data-testid="task-detail-drawer" style={{ width }}>
      {/* Resize handle */}
      <div
        className="task-drawer__resize-handle"
        onMouseDown={handleResizeStart}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            setWidth((w) => Math.max(MIN_DRAWER_WIDTH, w - (e.shiftKey ? 50 : 10)))
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            setWidth((w) => Math.min(MAX_DRAWER_WIDTH, w + (e.shiftKey ? 50 : 10)))
          }
        }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize drawer"
        aria-valuenow={width}
        aria-valuemin={MIN_DRAWER_WIDTH}
        aria-valuemax={MAX_DRAWER_WIDTH}
        tabIndex={0}
      />
      {/* Header */}
      <div className="task-drawer__head">
        <h2 className="task-drawer__title">{task.title}</h2>
        <div className="task-drawer__status">
          <span
            className="task-drawer__status-dot"
            style={{ background: getDotColor(task.status, task.pr_status) }}
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

        {depTasks.length > 0 && (
          <div className="task-drawer__deps">
            <div className="task-drawer__deps-label">
              {task.status === 'blocked' ? 'Blocked by' : 'Dependencies'}
            </div>
            {depTasks.map((dep) => (
              <button
                key={dep.id}
                className={`task-drawer__dep task-drawer__dep--${dep.status}`}
                onClick={() => setSelectedTaskId(dep.id)}
              >
                <span className="task-drawer__dep-dot" />
                <span className="task-drawer__dep-title">{dep.title.slice(0, 50)}</span>
                <span className="task-drawer__dep-status">{dep.status}</span>
              </button>
            ))}
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
            {task.notes &&
              (() => {
                const match = task.notes.match(/Branch\s+(\S+)\s+pushed\s+to\s+(\S+)/)
                if (!match) return null
                const [, branch, ghRepo] = match
                // Validate ghRepo format (owner/repo) to prevent XSS
                if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(ghRepo)) return null
                // Validate branch name doesn't contain dangerous characters
                if (!/^[a-zA-Z0-9/_.-]+$/.test(branch)) return null
                return (
                  <a
                    className="task-drawer__btn task-drawer__btn--primary task-drawer__branch-only-link"
                    href={`https://github.com/${encodeURIComponent(ghRepo)}/pull/new/${encodeURIComponent(branch)}`}
                    target="_blank"
                    rel="noreferrer"
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
          onRerun={onRerun}
          onDelete={onDelete}
          onViewLogs={onViewLogs}
          onEdit={onEdit}
          onUnblock={onUnblock}
          onRetry={onRetry}
        />
      </div>
    </aside>
  )
}

function ActionButtons({
  task,
  onLaunch,
  onStop,
  onRerun,
  onDelete,
  onViewLogs,
  onEdit,
  onUnblock,
  onRetry
}: {
  task: SprintTask
  onLaunch: (t: SprintTask) => void
  onStop: (t: SprintTask) => void
  onRerun: (t: SprintTask) => void
  onDelete: (t: SprintTask) => void
  onViewLogs: (t: SprintTask) => void
  onEdit: (t: SprintTask) => void
  onUnblock?: (t: SprintTask) => void
  onRetry?: (t: SprintTask) => void
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
            onClick={() => (onUnblock ? onUnblock(task) : onLaunch(task))}
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
          {task.pr_url &&
            (() => {
              // Validate pr_url is a GitHub URL to prevent XSS
              try {
                const url = new URL(task.pr_url)
                if (url.hostname !== 'github.com') return null
                return (
                  <a
                    className="task-drawer__btn task-drawer__btn--primary"
                    href={task.pr_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View PR
                  </a>
                )
              } catch {
                return null
              }
            })()}
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => onRerun(task)}
          >
            Clone & Queue
          </button>
        </>
      )
    case 'failed':
    case 'error':
    case 'cancelled':
      return (
        <>
          {(task.status === 'failed' || task.status === 'error') && onRetry && (
            <button
              className="task-drawer__btn task-drawer__btn--primary"
              onClick={() => onRetry(task)}
            >
              <RefreshCw size={12} /> Retry
            </button>
          )}
          <button
            className="task-drawer__btn task-drawer__btn--secondary"
            onClick={() => onRerun(task)}
          >
            Clone & Queue
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
