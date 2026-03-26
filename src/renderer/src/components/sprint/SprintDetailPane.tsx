/**
 * SprintDetailPane — Neon-styled context-aware detail pane for Sprint Center.
 * Uses V2 neon design tokens via CSS classes in sprint-neon.css.
 */
import { useState, useMemo, useCallback } from 'react'
import {
  Clock,
  GitBranch,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  PlayCircle,
  StopCircle,
  RefreshCw,
  Edit3,
  Trash2,
  ChevronRight,
} from 'lucide-react'
import { Badge } from '../ui/Badge'
import { renderMarkdown } from '../../lib/render-markdown'
import { useSprintTasks } from '../../stores/sprintTasks'
import { TASK_STATUS } from '../../../../shared/constants'
import { toast } from '../../stores/toasts'
import type { SprintTask } from '../../../../shared/types'

export interface SprintDetailPaneProps {
  task: SprintTask | null
  onClose: () => void
  onLaunch?: (task: SprintTask) => void
  onStop?: (task: SprintTask) => void
  onRerun?: (task: SprintTask) => void
  onMarkDone?: (task: SprintTask) => void
  onDelete?: (taskId: string) => void
  onSaveSpec?: (taskId: string, spec: string) => void
  onEditInWorkbench?: (task: SprintTask) => void
}

function statusBadgeVariant(
  status: string,
): 'default' | 'success' | 'danger' | 'warning' | 'info' {
  switch (status) {
    case TASK_STATUS.ACTIVE:
      return 'success'
    case TASK_STATUS.DONE:
      return 'info'
    case TASK_STATUS.FAILED:
    case TASK_STATUS.ERROR:
      return 'danger'
    case TASK_STATUS.BLOCKED:
      return 'warning'
    case TASK_STATUS.QUEUED:
      return 'info'
    default:
      return 'default'
  }
}

function getStatusDisplay(task: SprintTask): string {
  if (task.status === 'active' && task.pr_status === 'open') return 'Review'
  if (task.status === 'done' && task.pr_status === 'open') return 'Review'
  switch (task.status) {
    case 'active': return 'Active'
    case 'queued': return 'Queued'
    case 'blocked': return 'Blocked'
    case 'backlog': return 'Backlog'
    case 'done': return 'Done'
    case 'failed': return 'Failed'
    case 'cancelled': return 'Cancelled'
    case 'error': return 'Error'
    default: return task.status
  }
}

export function SprintDetailPane({
  task,
  onClose,
  onLaunch,
  onStop,
  onRerun,
  onMarkDone,
  onDelete,
  onSaveSpec,
  onEditInWorkbench,
}: SprintDetailPaneProps) {
  const [editingSpec, setEditingSpec] = useState(false)
  const [specDraft, setSpecDraft] = useState('')
  const [specExpanded, setSpecExpanded] = useState(true)

  const allTasks = useSprintTasks((s) => s.tasks)

  const dependencyTasks = useMemo(() => {
    if (!task?.depends_on) return []
    return task.depends_on
      .map((dep) => allTasks.find((t) => t.id === dep.id))
      .filter((t): t is SprintTask => t !== undefined)
  }, [task?.depends_on, allTasks])

  const handleSaveSpec = useCallback(() => {
    if (!task || !onSaveSpec) return
    onSaveSpec(task.id, specDraft)
    setEditingSpec(false)
    toast.success('Spec saved')
  }, [task, specDraft, onSaveSpec])

  const handleStartEditSpec = useCallback(() => {
    if (!task) return
    setSpecDraft(task.spec || task.prompt || '')
    setEditingSpec(true)
  }, [task])

  const handleDelete = useCallback(() => {
    if (!task || !onDelete) return
    if (confirm(`Delete task "${task.title}"?`)) {
      onDelete(task.id)
      onClose()
      toast.success('Task deleted')
    }
  }, [task, onDelete, onClose])

  if (!task) {
    return (
      <div className="sprint-detail sprint-detail--empty">
        <span className="sprint-detail__empty-text">
          &gt; Select a task to view details
        </span>
      </div>
    )
  }

  const isActive = task.status === TASK_STATUS.ACTIVE
  const isDone = task.status === TASK_STATUS.DONE
  const isFailed = task.status === TASK_STATUS.FAILED || task.status === TASK_STATUS.ERROR
  const isQueued = task.status === TASK_STATUS.QUEUED
  const isBlocked = task.status === TASK_STATUS.BLOCKED
  const hasAgent = !!task.agent_run_id
  const hasPR = !!task.pr_url
  const hasSpec = !!task.spec

  const depsComplete = dependencyTasks.filter((d) => d.status === 'done').length
  const depsTotal = dependencyTasks.length

  return (
    <div className="sprint-detail">
      <div className="sprint-detail__header">
        <div className="sprint-detail__title-row">
          <span className="sprint-detail__title" title={task.title}>
            {task.title}
          </span>
          <Badge variant={statusBadgeVariant(task.status)} size="sm">
            {getStatusDisplay(task)}
          </Badge>
        </div>

        <div className="sprint-detail__meta-strip">
          <div className="sprint-detail__meta-item">
            <span className="sprint-detail__meta-item-icon"><GitBranch size={13} /></span>
            <span className="sprint-detail__meta-item-label">Repo</span>
            <span className="sprint-detail__meta-item-value">{task.repo}</span>
          </div>
          <div className="sprint-detail__meta-item">
            <span className="sprint-detail__meta-item-label">Priority</span>
            <span className={`sprint-detail__meta-item-value${task.priority <= 2 ? ' sprint-detail__meta-item-value--accent' : ''}`}>P{task.priority}</span>
          </div>
          {task.created_at && (
            <div className="sprint-detail__meta-item">
              <span className="sprint-detail__meta-item-icon"><Clock size={13} /></span>
              <span className="sprint-detail__meta-item-label">Created</span>
              <span className="sprint-detail__meta-item-value">
                {new Date(task.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, {new Date(task.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
          )}
          {task.started_at && (
            <div className="sprint-detail__meta-item">
              <span className="sprint-detail__meta-item-label">Started</span>
              <span className="sprint-detail__meta-item-value">
                {new Date(task.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, {new Date(task.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
          )}
        </div>

        <div className="sprint-detail__actions">
          {isQueued && onLaunch && (
            <button
              className="sprint-detail__action-btn sprint-detail__action-btn--primary"
              onClick={() => onLaunch(task)}
            >
              <PlayCircle size={13} /> Launch
            </button>
          )}
          {isActive && onStop && (
            <button
              className="sprint-detail__action-btn sprint-detail__action-btn--danger"
              onClick={() => onStop(task)}
            >
              <StopCircle size={13} /> Stop
            </button>
          )}
          {(isFailed || (isDone && !hasPR)) && onRerun && (
            <button className="sprint-detail__action-btn" onClick={() => onRerun(task)}>
              <RefreshCw size={13} /> Re-run
            </button>
          )}
          {(isQueued || isActive) && onMarkDone && (
            <button className="sprint-detail__action-btn" onClick={() => onMarkDone(task)}>
              <CheckCircle2 size={13} /> Done
            </button>
          )}
          {onEditInWorkbench && (
            <button
              className="sprint-detail__action-btn"
              onClick={() => onEditInWorkbench(task)}
            >
              <Edit3 size={13} /> Edit
            </button>
          )}
          {onDelete && (
            <button
              className="sprint-detail__action-btn sprint-detail__action-btn--danger-ghost"
              onClick={handleDelete}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="sprint-detail__body">
        {dependencyTasks.length > 0 && (
          <NeonSection
            title="Dependencies"
            expanded
            headerRight={<span className="sprint-detail__section-header-right">{depsComplete}/{depsTotal}</span>}
          >
            <div className="sprint-detail__deps">
              {dependencyTasks.map((dep) => (
                <div key={dep.id} className="sprint-detail__dep-row">
                  <span
                    className={`sprint-detail__dep-dot ${dep.status === 'done' ? 'sprint-detail__dep-dot--done' : ''}`}
                  >
                    {dep.status === 'done' ? '\u2713' : '\u25CB'}
                  </span>
                  <span className="sprint-detail__dep-title">{dep.title}</span>
                  <Badge variant={statusBadgeVariant(dep.status)} size="sm">
                    {dep.status}
                  </Badge>
                </div>
              ))}
            </div>
          </NeonSection>
        )}

        {isBlocked && (
          <div className="sprint-detail__blocked-alert">
            <AlertCircle size={14} />
            <div>
              <strong>Task is blocked</strong>
              <br />
              {dependencyTasks.length > 0
                ? `Waiting for ${dependencyTasks.filter((d) => d.status !== 'done').length} dependencies`
                : 'Dependencies must be resolved first'}
            </div>
          </div>
        )}

        {(hasSpec || task.prompt) && (
          <NeonSection
            title="Specification"
            expanded={specExpanded}
            onToggle={() => setSpecExpanded(!specExpanded)}
            className="sprint-detail__section--spec"
          >
            {editingSpec ? (
              <div className="sprint-detail__spec-edit">
                <textarea
                  className="sprint-detail__spec-textarea"
                  value={specDraft}
                  onChange={(e) => setSpecDraft(e.target.value)}
                />
                <div className="sprint-detail__spec-edit-actions">
                  <button
                    className="sprint-detail__action-btn sprint-detail__action-btn--primary"
                    onClick={handleSaveSpec}
                  >
                    Save
                  </button>
                  <button
                    className="sprint-detail__action-btn"
                    onClick={() => setEditingSpec(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="sprint-detail__spec-view">
                <div
                  className="sprint-detail__spec-content"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(task.spec || task.prompt || ''),
                  }}
                />
                {onSaveSpec && (
                  <button className="sprint-detail__action-btn" onClick={handleStartEditSpec}>
                    <Edit3 size={13} /> Edit Spec
                  </button>
                )}
              </div>
            )}
          </NeonSection>
        )}

        {hasAgent && (
          <div className="sprint-detail__agent-bar">
            <span className="sprint-detail__agent-dot" />
            <span className="sprint-detail__agent-id">{task.agent_run_id?.slice(0, 16)}</span>
            <span className="sprint-detail__agent-status">{isActive ? 'Running' : 'Completed'}</span>
            <button
              className="sprint-detail__agent-link"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('bde:navigate', {
                    detail: { view: 'agents', sessionId: task.agent_run_id },
                  }),
                )
              }}
            >
              Open in Agents &rarr;
            </button>
          </div>
        )}

        {hasPR && (
          <NeonSection title="Pull Request" expanded>
            <div className="sprint-detail__meta-grid">
              <MetaRow label="PR" value={`#${task.pr_number}`} />
              <MetaRow
                label="Status"
                value={task.pr_status || 'unknown'}
                badge={
                  task.pr_status === 'merged' ? (
                    <Badge variant="success" size="sm">
                      Merged
                    </Badge>
                  ) : task.pr_status === 'open' ? (
                    <Badge variant="info" size="sm">
                      Open
                    </Badge>
                  ) : task.pr_status === 'closed' ? (
                    <Badge variant="default" size="sm">
                      Closed
                    </Badge>
                  ) : null
                }
              />
              {task.pr_mergeable_state && (
                <MetaRow
                  label="Merge"
                  value={task.pr_mergeable_state}
                  badge={
                    task.pr_mergeable_state === 'dirty' ? (
                      <Badge variant="danger" size="sm">
                        Conflict
                      </Badge>
                    ) : task.pr_mergeable_state === 'clean' ? (
                      <Badge variant="success" size="sm">
                        Clean
                      </Badge>
                    ) : null
                  }
                />
              )}
            </div>
            <button
              className="sprint-detail__action-btn"
              onClick={() => task.pr_url && window.api.openExternal(task.pr_url)}
            >
              <ExternalLink size={13} /> View PR
            </button>
          </NeonSection>
        )}

        {task.notes && (
          <NeonSection title="Notes" expanded>
            <div className="sprint-detail__notes">{task.notes}</div>
          </NeonSection>
        )}
      </div>
    </div>
  )
}

// --- Helper Components ---

function NeonSection({
  title,
  expanded,
  onToggle,
  children,
  className,
  headerRight,
}: {
  title: string
  expanded: boolean
  onToggle?: () => void
  children: React.ReactNode
  className?: string
  headerRight?: React.ReactNode
}) {
  return (
    <div className={`sprint-detail__section${className ? ` ${className}` : ''}`}>
      <button className="sprint-detail__section-header" onClick={onToggle}>
        <ChevronRight
          size={12}
          className={`sprint-detail__section-chevron ${expanded ? 'sprint-detail__section-chevron--open' : ''}`}
        />
        <span>{title}</span>
        {headerRight}
      </button>
      {expanded && <div className="sprint-detail__section-body">{children}</div>}
    </div>
  )
}

function MetaRow({
  icon,
  label,
  value,
  mono,
  accent,
  badge,
}: {
  icon?: React.ReactNode
  label: string
  value: string
  mono?: boolean
  accent?: boolean
  badge?: React.ReactNode
}) {
  return (
    <div className="sprint-detail__meta-row">
      {icon && <span className="sprint-detail__meta-icon">{icon}</span>}
      <span className="sprint-detail__meta-label">{label}</span>
      <span
        className={`sprint-detail__meta-value${mono ? ' sprint-detail__meta-value--mono' : ''}${accent ? ' sprint-detail__meta-value--accent' : ''}`}
      >
        {value}
      </span>
      {badge}
    </div>
  )
}
