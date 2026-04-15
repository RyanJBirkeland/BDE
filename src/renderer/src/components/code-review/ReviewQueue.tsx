import './ReviewQueue.css'
import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useCodeReviewStore } from '../../stores/codeReview'
import { EmptyState } from '../ui/EmptyState'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { timeAgo } from '../../lib/format'

export function ReviewQueue(): React.JSX.Element {
  const reduced = useReducedMotion()

  // Scoped selector: only re-renders when the review-task subset changes.
  const reviewTasks = useSprintTasks(
    useShallow((s) =>
      s.tasks
        .filter((t) => t.status === 'review')
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    )
  )

  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const selectTask = useCodeReviewStore((s) => s.selectTask)
  const selectedBatchIds = useCodeReviewStore((s) => s.selectedBatchIds)
  const toggleBatchId = useCodeReviewStore((s) => s.toggleBatchId)
  const selectAllBatch = useCodeReviewStore((s) => s.selectAllBatch)
  const clearBatch = useCodeReviewStore((s) => s.clearBatch)

  const allSelected = reviewTasks.length > 0 && reviewTasks.every((t) => selectedBatchIds.has(t.id))

  // Stable refs keep the keydown handler stable so it is registered only once.
  const reviewTasksRef = useRef(reviewTasks)
  const selectedTaskIdRef = useRef(selectedTaskId)
  const selectTaskRef = useRef(selectTask)

  useEffect(() => {
    reviewTasksRef.current = reviewTasks
  }, [reviewTasks])

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId
  }, [selectedTaskId])

  useEffect(() => {
    selectTaskRef.current = selectTask
  }, [selectTask])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key !== 'j' && e.key !== 'k') return

      e.preventDefault()
      const tasks = reviewTasksRef.current
      if (tasks.length === 0) return

      const currentIndex = tasks.findIndex((t) => t.id === selectedTaskIdRef.current)
      let nextIndex: number

      if (e.key === 'j') {
        nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, tasks.length - 1)
      } else {
        nextIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0)
      }

      selectTaskRef.current(tasks[nextIndex].id)
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // Empty deps: handler reads latest values via refs, registered once on mount.
  }, [])

  return (
    <div className="cr-queue">
      <div className="cr-queue__header">
        <label className="cr-queue__select-all">
          <input
            type="checkbox"
            aria-label={`Select all ${reviewTasks.length} review tasks`}
            checked={allSelected}
            onChange={() => {
              if (allSelected) clearBatch()
              else selectAllBatch(reviewTasks.map((t) => t.id))
            }}
          />
        </label>
        <span className="cr-queue__title text-gradient-aurora">Review Queue</span>
        <span className="cr-queue__count">{reviewTasks.length}</span>
        {/* Screen reader announcement for batch selection changes */}
        <span
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {selectedBatchIds.size > 0 ? `${selectedBatchIds.size} tasks selected` : ''}
        </span>
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
    </div>
  )
}
