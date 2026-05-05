import './ReviewQueue.css'
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { GitPullRequest } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useCodeReviewStore } from '../../stores/codeReview'
import { usePanelLayoutStore } from '../../stores/panelLayout'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../../lib/motion'
import { timeAgo } from '../../lib/format'
import { PrBuilderModal } from './PrBuilderModal'

export function ReviewQueue(): React.JSX.Element {
  const reduced = useReducedMotion()
  const navigateToPipeline = usePanelLayoutStore((s) => s.setView)
  const [showPrBuilder, setShowPrBuilder] = useState(false)

  // Scoped selector: only re-renders when the review/approved task subsets change.
  const allQueueTasks = useSprintTasks(
    useShallow((s) =>
      s.tasks
        .filter((t) => t.status === 'review' || t.status === 'approved')
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    )
  )

  const pendingReviewTasks = allQueueTasks.filter((t) => t.status === 'review')
  const approvedTasks = allQueueTasks.filter((t) => t.status === 'approved')

  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const selectTask = useCodeReviewStore((s) => s.selectTask)
  const selectedBatchIds = useCodeReviewStore((s) => s.selectedBatchIds)
  const toggleBatchId = useCodeReviewStore((s) => s.toggleBatchId)
  const selectAllBatch = useCodeReviewStore((s) => s.selectAllBatch)
  const clearBatch = useCodeReviewStore((s) => s.clearBatch)

  // Batch select-all covers only pending review tasks (approved tasks have separate actions).
  const reviewTasks = pendingReviewTasks
  const allSelected = reviewTasks.length > 0 && reviewTasks.every((t) => selectedBatchIds.has(t.id))

  // Stable refs keep the keydown handler stable so it is registered only once.
  // j/k navigation traverses both sections in order: pending review first, then approved.
  const allQueueTasksRef = useRef(allQueueTasks)
  const selectedTaskIdRef = useRef(selectedTaskId)
  const selectTaskRef = useRef(selectTask)

  useEffect(() => { allQueueTasksRef.current = allQueueTasks }, [allQueueTasks])
  useEffect(() => { selectedTaskIdRef.current = selectedTaskId }, [selectedTaskId])
  useEffect(() => { selectTaskRef.current = selectTask }, [selectTask])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key !== 'j' && e.key !== 'k') return

      e.preventDefault()
      const tasks = allQueueTasksRef.current
      if (tasks.length === 0) return

      const currentIndex = tasks.findIndex((t) => t.id === selectedTaskIdRef.current)
      let nextIndex: number

      if (e.key === 'j') {
        nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, tasks.length - 1)
      } else {
        nextIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0)
      }

      const nextTask = tasks[nextIndex]
      if (nextTask) selectTaskRef.current(nextTask.id)
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // Empty deps: handler reads latest values via refs, registered once on mount.
  }, [])

  return (
    <div className="cr-queue">
      {/* ── Pending Review section ─────────────────────────── */}
      <section aria-label="Pending Review">
        <div className="cr-queue__header">
          <label className="cr-queue__select-all">
            <input
              type="checkbox"
              aria-label={`Select all ${reviewTasks.length} pending review tasks`}
              checked={allSelected}
              onChange={() => {
                if (allSelected) clearBatch()
                else selectAllBatch(reviewTasks.map((t) => t.id))
              }}
            />
          </label>
          <span className="cr-queue__eyebrow">Pending Review</span>
          <span className="cr-queue__title">Pending</span>
          <span className="cr-queue__count">{reviewTasks.length}</span>
          <span aria-live="polite" aria-atomic="true" className="sr-only">
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
              >
                {timeAgo(task.completed_at ?? task.updated_at)}
              </span>
            </motion.button>
          ))}
          {reviewTasks.length === 0 && (
            <div className="cr-queue__empty">
              <p className="cr-queue__empty-message">
                No tasks awaiting review. Tasks appear here when agents complete their work.
              </p>
              <button
                className="cr-queue__empty-cta"
                onClick={() => navigateToPipeline('sprint')}
              >
                Go to Pipeline
              </button>
            </div>
          )}
        </motion.div>
      </section>

      {/* ── Approved section ──────────────────────────────── */}
      <section aria-label="Approved">
        <div className="cr-queue__header cr-queue__header--approved">
          <span className="cr-queue__eyebrow">Approved</span>
          <span className="cr-queue__title">Approved</span>
          <span className="cr-queue__count">{approvedTasks.length}</span>
          {approvedTasks.length > 0 && (
            <button
              className="cr-queue__build-pr-btn"
              onClick={() => setShowPrBuilder(true)}
              title="Build a PR from approved tasks"
            >
              <GitPullRequest size={12} />
              Build PR
            </button>
          )}
        </div>

        <motion.div
          className="cr-queue__list"
          variants={VARIANTS.staggerContainer}
          initial="initial"
          animate="animate"
        >
          {approvedTasks.map((task) => (
            <motion.button
              key={task.id}
              className={`cr-queue__item${task.id === selectedTaskId ? ' cr-queue__item--selected' : ''}`}
              onClick={() => selectTask(task.id)}
              variants={VARIANTS.staggerChild}
              transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
            >
              <span className="cr-queue__item-title">{task.title}</span>
              <span className="cr-queue__item-repo">{task.repo}</span>
              <span
                className="cr-queue__item-age"
                data-testid={`cr-queue-age-${task.id}`}
                title={new Date(task.completed_at ?? task.updated_at).toLocaleString()}
              >
                {timeAgo(task.completed_at ?? task.updated_at)}
              </span>
            </motion.button>
          ))}
          {approvedTasks.length === 0 && (
            <div className="cr-queue__empty cr-queue__empty--compact">
              <p className="cr-queue__empty-message">No approved tasks yet.</p>
            </div>
          )}
        </motion.div>
      </section>

      <PrBuilderModal
        open={showPrBuilder}
        repo={approvedTasks[0]?.repo ?? ''}
        onClose={() => setShowPrBuilder(false)}
      />
    </div>
  )
}
