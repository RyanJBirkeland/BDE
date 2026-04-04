import { useEffect } from 'react'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useCodeReviewStore } from '../../stores/codeReview'

export function ReviewQueue(): React.JSX.Element {
  const tasks = useSprintTasks((s) => s.tasks)
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const selectTask = useCodeReviewStore((s) => s.selectTask)
  const selectedBatchIds = useCodeReviewStore((s) => s.selectedBatchIds)
  const toggleBatchId = useCodeReviewStore((s) => s.toggleBatchId)
  const selectAllBatch = useCodeReviewStore((s) => s.selectAllBatch)
  const clearBatch = useCodeReviewStore((s) => s.clearBatch)

  const reviewTasks = tasks
    .filter((t) => t.status === 'review')
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  const allSelected = reviewTasks.length > 0 && reviewTasks.every((t) => selectedBatchIds.has(t.id))

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key !== 'j' && e.key !== 'k') return

      e.preventDefault()
      if (reviewTasks.length === 0) return

      const currentIndex = reviewTasks.findIndex((t) => t.id === selectedTaskId)
      let nextIndex: number

      if (e.key === 'j') {
        nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, reviewTasks.length - 1)
      } else {
        nextIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0)
      }

      selectTask(reviewTasks[nextIndex].id)
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [reviewTasks, selectedTaskId, selectTask])

  return (
    <aside className="cr-queue">
      <div className="cr-queue__header">
        <label className="cr-queue__select-all">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => {
              if (allSelected) clearBatch()
              else selectAllBatch(reviewTasks.map((t) => t.id))
            }}
          />
        </label>
        <span className="cr-queue__title">Review Queue</span>
        <span className="cr-queue__count">{reviewTasks.length}</span>
      </div>
      <div className="cr-queue__list">
        {reviewTasks.map((task) => (
          <button
            key={task.id}
            className={`cr-queue__item${task.id === selectedTaskId ? ' cr-queue__item--selected' : ''}`}
            onClick={() => selectTask(task.id)}
          >
            <input
              type="checkbox"
              className="cr-queue__checkbox"
              checked={selectedBatchIds.has(task.id)}
              onChange={(e) => {
                e.stopPropagation()
                toggleBatchId(task.id)
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="cr-queue__item-title">{task.title}</span>
            <span className="cr-queue__item-repo">{task.repo}</span>
          </button>
        ))}
        {reviewTasks.length === 0 && (
          <div className="cr-queue__empty">No tasks awaiting review</div>
        )}
      </div>
    </aside>
  )
}
