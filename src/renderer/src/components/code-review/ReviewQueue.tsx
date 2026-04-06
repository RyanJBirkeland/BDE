import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useCodeReviewStore } from '../../stores/codeReview'
import { EmptyState } from '../ui/EmptyState'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { timeAgo } from '../../lib/format'

export function ReviewQueue(): React.JSX.Element {
  const reduced = useReducedMotion()
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
        <span className="cr-queue__title text-gradient-aurora">Review Queue</span>
        <span className="cr-queue__count">{reviewTasks.length}</span>
      </div>
      <motion.div
        className="cr-queue__list"
        variants={VARIANTS.staggerContainer}
        initial="initial"
        animate="animate"
      >
        {reviewTasks.map((task) => (
          <motion.button
            key={task.id}
            className={`cr-queue__item${task.id === selectedTaskId ? ' cr-queue__item--selected' : ''}`}
            onClick={() => selectTask(task.id)}
            variants={VARIANTS.staggerChild}
            transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
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
            <span
              className="cr-queue__item-age"
              data-testid={`cr-queue-age-${task.id}`}
              title={new Date(task.completed_at ?? task.updated_at).toLocaleString()}
              style={{
                marginLeft: 'auto',
                fontSize: 10,
                color: 'var(--bde-text-dim, rgba(255,255,255,0.5))'
              }}
            >
              {timeAgo(task.completed_at ?? task.updated_at)}
            </span>
          </motion.button>
        ))}
        {reviewTasks.length === 0 && (
          <EmptyState message="No tasks awaiting review. Complete agent runs will appear here for inspection." />
        )}
      </motion.div>
    </aside>
  )
}
