import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, ArrowRight, Eye, CheckCircle2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import type { SprintTask } from '../../../../shared/types'

type TaskTableProps = {
  section: 'done' | 'backlog' | 'failed'
  tasks: SprintTask[]
  defaultExpanded?: boolean
  defaultRowLimit?: number
  onPushToSprint: (task: SprintTask) => void
  onViewSpec: (task: SprintTask) => void
  onViewOutput: (task: SprintTask) => void
  onMarkDone?: (task: SprintTask) => void
}

const STORAGE_KEY_PREFIX = 'bde-table-'

function getInitialCollapsed(section: string, defaultExpanded: boolean): boolean {
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${section}-collapsed`)
    if (stored !== null) return stored === 'true'
  } catch {
    // localStorage unavailable
  }
  return !defaultExpanded
}

function priorityVariant(priority: number): 'danger' | 'warning' | 'muted' {
  if (priority <= 1) return 'danger'
  if (priority <= 3) return 'warning'
  return 'muted'
}

function repoBadgeVariant(repo: string): 'info' | 'warning' | 'success' | 'default' {
  const lower = repo.toLowerCase()
  if (lower === 'bde') return 'info'
  if (lower === 'feast') return 'warning'
  if (lower === 'life-os') return 'success'
  return 'default'
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function TaskTable({
  section,
  tasks,
  defaultExpanded = true,
  defaultRowLimit = (section === 'done' || section === 'failed') ? 10 : undefined,
  onPushToSprint,
  onViewSpec,
  onViewOutput,
  onMarkDone,
}: TaskTableProps) {
  const [collapsed, setCollapsed] = useState(() => getInitialCollapsed(section, defaultExpanded))
  const [showAll, setShowAll] = useState(false)

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    if (next) setShowAll(false)
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${section}-collapsed`, String(next))
    } catch {
      // ignore
    }
  }

  const sorted =
    section === 'done' || section === 'failed'
      ? [...tasks].sort(
          (a, b) => new Date(b.completed_at ?? b.updated_at).getTime() - new Date(a.completed_at ?? a.updated_at).getTime()
        )
      : [...tasks].sort((a, b) => a.priority - b.priority)

  const limit = defaultRowLimit && !showAll ? defaultRowLimit : undefined
  const visible = limit ? sorted.slice(0, limit) : sorted
  const hiddenCount = limit ? Math.max(0, sorted.length - limit) : 0

  const Chevron = collapsed ? ChevronRight : ChevronDown

  return (
    <div className="bde-task-section">
      <div className="bde-task-section__header" onClick={toggleCollapsed}>
        <Chevron size={14} />
        <span>{section === 'done' ? 'Done' : section === 'failed' ? 'Failed / Cancelled' : 'Backlog'}</span>
        <span className="sprint-col__count bde-count-badge">{tasks.length}</span>
      </div>

      {!collapsed && (
        <>
          {tasks.length === 0 ? (
            <div className="bde-task-table__empty">
              {section === 'done' ? 'No completed tasks' : section === 'failed' ? 'No failed tasks' : 'Backlog is empty'}
            </div>
          ) : (
            <>
              <table className={`bde-task-table ${section === 'failed' ? 'bde-task-table--dimmed' : ''}`}>
                <thead>
                  {section === 'done' || section === 'failed' ? (
                    <tr>
                      <th>Title</th>
                      <th>Repo</th>
                      <th>{section === 'failed' ? 'Cancelled' : 'Completed'}</th>
                      <th>PR</th>
                      <th></th>
                    </tr>
                  ) : (
                    <tr>
                      <th>Title</th>
                      <th>Pri</th>
                      <th>Repo</th>
                      <th></th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {visible.map((task) =>
                    section === 'failed' ? (
                      <FailedRow
                        key={task.id}
                        task={task}
                        onViewSpec={onViewSpec}
                        onViewOutput={onViewOutput}
                        onPushToSprint={onPushToSprint}
                      />
                    ) : section === 'done' ? (
                      <DoneRow
                        key={task.id}
                        task={task}
                        onViewSpec={onViewSpec}
                        onViewOutput={onViewOutput}
                      />
                    ) : (
                      <BacklogRow
                        key={task.id}
                        task={task}
                        onPushToSprint={onPushToSprint}
                        onViewSpec={onViewSpec}
                        onMarkDone={onMarkDone}
                      />
                    )
                  )}
                </tbody>
              </table>
              {hiddenCount > 0 && (
                <button className="bde-task-section__show-more" onClick={() => setShowAll(true)}>
                  Show {hiddenCount} more →
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function DoneRow({
  task,
  onViewSpec,
  onViewOutput,
}: {
  task: SprintTask
  onViewSpec: (t: SprintTask) => void
  onViewOutput: (t: SprintTask) => void
}) {
  return (
    <tr>
      <td>
        <button className="bde-task-table__title-btn" onClick={() => onViewSpec(task)}>
          {task.title}
        </button>
      </td>
      <td>
        <Badge variant={repoBadgeVariant(task.repo)} size="sm">
          {task.repo}
        </Badge>
      </td>
      <td className="bde-task-table__date">{formatDate(task.completed_at)}</td>
      <td>
        {task.pr_url ? (
          <a
            href={task.pr_url}
            target="_blank"
            rel="noreferrer"
            className="bde-task-table__pr-link"
            onClick={(e) => e.stopPropagation()}
          >
            #{task.pr_number} <ExternalLink size={10} />
          </a>
        ) : (
          <span className="bde-task-table__muted">—</span>
        )}
      </td>
      <td>
        <button
          className="bde-task-table__action-btn"
          onClick={() => onViewOutput(task)}
          title="View Output"
        >
          <Eye size={13} />
        </button>
      </td>
    </tr>
  )
}

function FailedRow({
  task,
  onViewSpec,
  onViewOutput,
  onPushToSprint,
}: {
  task: SprintTask
  onViewSpec: (t: SprintTask) => void
  onViewOutput: (t: SprintTask) => void
  onPushToSprint: (t: SprintTask) => void
}) {
  return (
    <tr className="bde-task-table__row--dimmed">
      <td>
        <button className="bde-task-table__title-btn" onClick={() => onViewSpec(task)}>
          {task.title}
        </button>
      </td>
      <td>
        <Badge variant={repoBadgeVariant(task.repo)} size="sm">
          {task.repo}
        </Badge>
      </td>
      <td className="bde-task-table__date">{formatDate(task.updated_at)}</td>
      <td>
        {task.pr_url ? (
          <a
            href={task.pr_url}
            target="_blank"
            rel="noreferrer"
            className="bde-task-table__pr-link"
            onClick={(e) => e.stopPropagation()}
          >
            #{task.pr_number} <ExternalLink size={10} />
          </a>
        ) : (
          <span className="bde-task-table__muted">—</span>
        )}
      </td>
      <td className="bde-task-table__actions-cell">
        <button
          className="bde-task-table__action-btn"
          onClick={() => onViewOutput(task)}
          title="View Output"
        >
          <Eye size={13} />
        </button>
        <button
          className="bde-task-table__action-btn bde-task-table__action-btn--sprint"
          onClick={() => onPushToSprint(task)}
          title="Retry — move back to sprint"
        >
          <ArrowRight size={13} /> Retry
        </button>
      </td>
    </tr>
  )
}

function BacklogRow({
  task,
  onPushToSprint,
  onViewSpec,
  onMarkDone,
}: {
  task: SprintTask
  onPushToSprint: (t: SprintTask) => void
  onViewSpec: (t: SprintTask) => void
  onMarkDone?: (t: SprintTask) => void
}) {
  return (
    <tr>
      <td>
        <button className="bde-task-table__title-btn" onClick={() => onViewSpec(task)}>
          {task.title}
        </button>
      </td>
      <td>
        <span className={`bde-task-table__priority-dot bde-task-table__priority-dot--${priorityVariant(task.priority)}`} title={'P' + task.priority} />
      </td>
      <td>
        <Badge variant={repoBadgeVariant(task.repo)} size="sm">
          {task.repo}
        </Badge>
      </td>
      <td className="bde-task-table__actions-cell">
        {onMarkDone && (
          <button
            className="bde-task-table__action-btn bde-task-table__action-btn--done"
            onClick={() => onMarkDone(task)}
            title="Mark Done"
          >
            <CheckCircle2 size={13} />
          </button>
        )}
        <button className="bde-task-table__action-btn bde-task-table__action-btn--sprint" onClick={() => onPushToSprint(task)}>
          <ArrowRight size={13} /> Sprint
        </button>
      </td>
    </tr>
  )
}
