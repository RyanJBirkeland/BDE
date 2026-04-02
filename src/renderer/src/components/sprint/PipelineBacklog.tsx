import { useState } from 'react'
import type { SprintTask } from '../../../../shared/types'

interface PipelineBacklogProps {
  backlog: SprintTask[]
  failed: SprintTask[]
  onTaskClick: (id: string) => void
  onAddToQueue: (task: SprintTask) => void
  onRerun: (task: SprintTask) => void
}

const FAILED_VISIBLE_LIMIT = 3

export function PipelineBacklog({
  backlog,
  failed,
  onTaskClick,
  onAddToQueue,
  onRerun,
}: PipelineBacklogProps) {
  const [failedExpanded, setFailedExpanded] = useState(false)
  const visibleFailed = failedExpanded ? failed : failed.slice(0, FAILED_VISIBLE_LIMIT)
  const hiddenCount = failed.length - FAILED_VISIBLE_LIMIT
  return (
    <div className="pipeline-sidebar" data-testid="pipeline-backlog">
      <div className="pipeline-sidebar__section pipeline-sidebar__section--grow">
        <div className="pipeline-sidebar__label pipeline-sidebar__label--backlog">
          BACKLOG <span className="pipeline-sidebar__count">{backlog.length}</span>
        </div>
        {backlog.map((task) => (
          <div
            key={task.id}
            className="backlog-card"
            role="button"
            aria-label={task.title}
            tabIndex={0}
            onClick={() => onTaskClick(task.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTaskClick(task.id) } }}
          >
            <div className="backlog-card__title">{task.title}</div>
            <div className="backlog-card__meta">
              <span>{task.repo}</span>
              {task.priority <= 2 && <span>P{task.priority}</span>}
            </div>
            <button
              className="backlog-card__action"
              onClick={(e) => {
                e.stopPropagation()
                onAddToQueue(task)
              }}
            >
              → Add to queue
            </button>
          </div>
        ))}
        {backlog.length === 0 && (
          <div className="pipeline-sidebar__empty">
            No backlog tasks
          </div>
        )}
      </div>
      {failed.length > 0 && (
        <div className="pipeline-sidebar__section">
          <div className="pipeline-sidebar__label pipeline-sidebar__label--failed">
            FAILED <span className="pipeline-sidebar__count">{failed.length}</span>
          </div>
          {visibleFailed.map((task) => (
            <div
              key={task.id}
              className="failed-card"
              role="button"
              aria-label={task.title}
              tabIndex={0}
              onClick={() => onTaskClick(task.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTaskClick(task.id) } }}
            >
              <div className="failed-card__title">{task.title}</div>
              <div className="failed-card__meta failed-card__notes" title={task.notes || 'No details'}>
                {task.notes || 'No details'}
              </div>
              <button
                className="backlog-card__action failed-card__action--rerun"
                onClick={(e) => {
                  e.stopPropagation()
                  onRerun(task)
                }}
              >
                ↻ Re-run
              </button>
            </div>
          ))}
          {!failedExpanded && hiddenCount > 0 && (
            <button
              className="pipeline-sidebar__expand"
              onClick={() => setFailedExpanded(true)}
            >
              +{hiddenCount} more...
            </button>
          )}
          {failedExpanded && failed.length > FAILED_VISIBLE_LIMIT && (
            <button
              className="pipeline-sidebar__expand"
              onClick={() => setFailedExpanded(false)}
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  )
}
