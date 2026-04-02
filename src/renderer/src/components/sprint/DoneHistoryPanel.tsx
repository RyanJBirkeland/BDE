import { useEffect, useRef } from 'react'
import type { SprintTask } from '../../../../shared/types'

interface DoneHistoryPanelProps {
  tasks: SprintTask[]
  onTaskClick: (id: string) => void
  onClose: () => void
}

export function DoneHistoryPanel({ tasks, onTaskClick, onClose }: DoneHistoryPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Focus trap — keep Tab cycling within the panel
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length === 0) return

    const first = focusable[0]
    first.focus()

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const current = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (current.length === 0) return
      const f = current[0]
      const l = current[current.length - 1]
      if (e.shiftKey && document.activeElement === f) {
        e.preventDefault()
        l.focus()
      } else if (!e.shiftKey && document.activeElement === l) {
        e.preventDefault()
        f.focus()
      }
    }

    panel.addEventListener('keydown', handleTab)
    return () => panel.removeEventListener('keydown', handleTab)
  }, [tasks])

  return (
    <div className="done-history-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Completed Tasks">
      <div className="done-history" ref={panelRef} onClick={(e) => e.stopPropagation()}>
        <div className="done-history__header">
          <div className="done-history__title">Completed Tasks ({tasks.length})</div>
          <button className="done-history__close" onClick={onClose} data-testid="dhp-close" aria-label="Close">✕</button>
        </div>
        <div className="done-history__list" role="list">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="done-history__item"
              onClick={() => onTaskClick(task.id)}
              role="listitem"
              tabIndex={0}
              aria-label={task.title}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onTaskClick(task.id)
                }
              }}
            >
              <span className="done-history__item-title">{task.title}</span>
              <span className="task-pill__badge done-history__badge">{task.repo}</span>
              <span className="done-history__item-time">
                {task.completed_at ? new Date(task.completed_at).toLocaleDateString() : ''}
              </span>
            </div>
          ))}
          {tasks.length === 0 && (
            <div className="done-history__empty">
              No completed tasks yet
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
