import React, { useState } from 'react'
import type { SprintTask } from '../../../../shared/types'
import { useSprintUI } from '../../stores/sprintUI'

interface PipelineBacklogProps {
  backlog: SprintTask[]
  failed: SprintTask[]
  onTaskClick: (id: string) => void
  onAddToQueue: (task: SprintTask) => void
  onRerun: (task: SprintTask) => void
  onClearFailures: () => void
  onRequeueAllFailed: () => void
}

const FAILED_VISIBLE_LIMIT = 3
const BACKLOG_VISIBLE_LIMIT = 40

function PipelineBacklogInner({
  backlog,
  failed,
  onTaskClick,
  onAddToQueue,
  onRerun,
  onClearFailures,
  onRequeueAllFailed
}: PipelineBacklogProps): React.JSX.Element {
  const [failedExpanded, setFailedExpanded] = useState(false)
  const [backlogExpanded, setBacklogExpanded] = useState(false)
  const selectedTaskIds = useSprintUI((s) => s.selectedTaskIds)
  const toggleTaskSelection = useSprintUI((s) => s.toggleTaskSelection)

  const visibleFailed = failedExpanded ? failed : failed.slice(0, FAILED_VISIBLE_LIMIT)
  const hiddenCount = failed.length - FAILED_VISIBLE_LIMIT
  const visibleBacklog = backlogExpanded ? backlog : backlog.slice(0, BACKLOG_VISIBLE_LIMIT)
  const hiddenBacklogCount = backlog.length - BACKLOG_VISIBLE_LIMIT

  const handleCheckboxClick = (e: React.MouseEvent, taskId: string): void => {
    e.stopPropagation()
    toggleTaskSelection(taskId)
  }

  return (
    <div className="pipeline-sidebar" data-testid="pipeline-backlog">
      <div className="pipeline-sidebar__section pipeline-sidebar__section--grow">
        <div className="pipeline-sidebar__label pipeline-sidebar__label--backlog">
          BACKLOG <span className="pipeline-sidebar__count">{backlog.length}</span>
        </div>
        {visibleBacklog.map((task) => {
          const isSelected = selectedTaskIds.has(task.id)
          return (
            <div
              key={task.id}
              className={`backlog-card ${isSelected ? 'backlog-card--selected' : ''}`}
              data-testid={`backlog-card-${task.id}`}
            >
              <div className="backlog-card__checkbox-wrapper">
                <input
                  type="checkbox"
                  className="backlog-card__checkbox"
                  checked={isSelected}
                  onChange={(e) => handleCheckboxClick(e as unknown as React.MouseEvent, task.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${task.title}`}
                />
              </div>
              <button
                className="backlog-card__select"
                aria-label={`Select task: ${task.title}`}
                onClick={() => onTaskClick(task.id)}
              >
                <div className="backlog-card__title">{task.title}</div>
                <div className="backlog-card__meta">
                  <span>{task.repo}</span>
                  {task.priority <= 2 && <span>P{task.priority}</span>}
                </div>
              </button>
              <button className="backlog-card__action" onClick={() => onAddToQueue(task)}>
                → Add to queue
              </button>
            </div>
          )
        })}
        {!backlogExpanded && hiddenBacklogCount > 0 && (
          <button className="pipeline-sidebar__expand" onClick={() => setBacklogExpanded(true)}>
            Show {hiddenBacklogCount} more
          </button>
        )}
        {backlogExpanded && backlog.length > BACKLOG_VISIBLE_LIMIT && (
          <button className="pipeline-sidebar__expand" onClick={() => setBacklogExpanded(false)}>
            Show less
          </button>
        )}
        {backlog.length === 0 && <div className="pipeline-sidebar__empty">No backlog tasks</div>}
      </div>
      {failed.length > 0 && (
        <div className="pipeline-sidebar__section">
          <div className="pipeline-sidebar__label pipeline-sidebar__label--failed">
            FAILED <span className="pipeline-sidebar__count">{failed.length}</span>
          </div>
          <div className="pipeline-sidebar__actions">
            <button
              className="pipeline-sidebar__action-btn"
              onClick={onRequeueAllFailed}
              title="Move all failed tasks back to queue"
            >
              ↻ Requeue all
            </button>
            <button
              className="pipeline-sidebar__action-btn pipeline-sidebar__action-btn--danger"
              onClick={onClearFailures}
              title="Delete all failed tasks"
            >
              ✕ Clear failures
            </button>
          </div>
          {visibleFailed.map((task) => (
            <div key={task.id} className="failed-card" data-testid={`failed-card-${task.id}`}>
              <button
                className="failed-card__select"
                aria-label={`Select task: ${task.title}`}
                onClick={() => onTaskClick(task.id)}
              >
                <div className="failed-card__title">{task.title}</div>
                <div
                  className="failed-card__meta failed-card__notes"
                  title={task.notes || 'No details'}
                >
                  {task.notes || 'No details'}
                </div>
              </button>
              <button
                className="backlog-card__action failed-card__action--rerun"
                onClick={() => onRerun(task)}
              >
                ↻ Re-run
              </button>
            </div>
          ))}
          {!failedExpanded && hiddenCount > 0 && (
            <button className="pipeline-sidebar__expand" onClick={() => setFailedExpanded(true)}>
              +{hiddenCount} more...
            </button>
          )}
          {failedExpanded && failed.length > FAILED_VISIBLE_LIMIT && (
            <button className="pipeline-sidebar__expand" onClick={() => setFailedExpanded(false)}>
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export const PipelineBacklog = React.memo(PipelineBacklogInner)
PipelineBacklog.displayName = 'PipelineBacklog'
