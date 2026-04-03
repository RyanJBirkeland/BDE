import { useEffect, useRef } from 'react'
import type { SprintTask } from '../../../../shared/types'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface DoneHistoryPanelProps {
  tasks: SprintTask[]
  onTaskClick: (id: string) => void
  onClose: () => void
}

export function DoneHistoryPanel({
  tasks,
  onTaskClick,
  onClose
}: DoneHistoryPanelProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Focus trap — keep Tab cycling within the panel
  useFocusTrap(panelRef, true)

  return (
    <div
      className="done-history-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Completed Tasks"
    >
      <div className="done-history" ref={panelRef} onClick={(e) => e.stopPropagation()}>
        <div className="done-history__header">
          <div className="done-history__title">Completed Tasks ({tasks.length})</div>
          <button
            className="done-history__close"
            onClick={onClose}
            data-testid="dhp-close"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="done-history__list">
          {tasks.map((task) => (
            <button
              key={task.id}
              className="done-history__item"
              onClick={() => onTaskClick(task.id)}
              aria-label={task.title}
            >
              <span className="done-history__item-title">{task.title}</span>
              <span className="task-pill__badge done-history__badge">{task.repo}</span>
              <span className="done-history__item-time">
                {task.completed_at ? new Date(task.completed_at).toLocaleDateString() : ''}
              </span>
            </button>
          ))}
          {tasks.length === 0 && <div className="done-history__empty">No completed tasks yet</div>}
        </div>
      </div>
    </div>
  )
}
