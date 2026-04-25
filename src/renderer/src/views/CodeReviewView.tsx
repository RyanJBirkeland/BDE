import './CodeReviewView.css'
import { useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { TopBar } from '../components/code-review/TopBar'
import { FileTreePanel } from '../components/code-review/FileTreePanel'
import { DiffViewerPanel } from '../components/code-review/DiffViewerPanel'
import { AIAssistantPanel } from '../components/code-review/AIAssistantPanel'
import { useCommandPaletteStore, type Command } from '../stores/commandPalette'
import { useCodeReviewStore } from '../stores/codeReview'
import { useSprintTasks } from '../stores/sprintTasks'
import { useReviewPartnerStore } from '../stores/reviewPartner'
import { useAutoReview } from '../hooks/useAutoReview'
import { toast } from '../stores/toasts'
import { VARIANTS, SPRINGS, REDUCED_TRANSITION, useReducedMotion } from '../lib/motion'
import { ErrorBoundary } from '../components/ui/ErrorBoundary'
import { GitHubOptedOutBanner } from '../components/GitHubOptedOutBanner'

export default function CodeReviewView(): React.JSX.Element {
  const reduced = useReducedMotion()
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands)
  const unregisterCommands = useCommandPaletteStore((s) => s.unregisterCommands)
  const selectTask = useCodeReviewStore((s) => s.selectTask)
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const selectAllBatch = useCodeReviewStore((s) => s.selectAllBatch)
  const clearBatch = useCodeReviewStore((s) => s.clearBatch)
  const tasks = useSprintTasks((s) => s.tasks)
  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : null
  useAutoReview(selectedTaskId, selectedTask?.status ?? null)
  const panelOpen = useReviewPartnerStore((s) => s.panelOpen)

  // Filter + sort once per task change instead of inside every j/k action callback.
  // Recomputing in three call sites was both O(n log n) per keystroke on large
  // task lists and a forced re-registration of all review commands on every poll.
  const reviewTasksSorted = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'review')
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [tasks]
  )

  useEffect(() => {
    const reviewCommands: Command[] = [
      {
        id: 'review-next',
        label: 'Select Next Review Task',
        category: 'review',
        hint: 'j',
        keywords: ['review', 'next', 'navigate'],
        action: () => {
          if (reviewTasksSorted.length === 0) {
            toast.error('No tasks in review')
            return
          }
          const currentIndex = reviewTasksSorted.findIndex((t) => t.id === selectedTaskId)
          const nextIndex =
            currentIndex === -1 ? 0 : Math.min(currentIndex + 1, reviewTasksSorted.length - 1)
          const nextTask = reviewTasksSorted[nextIndex]
          if (nextTask) selectTask(nextTask.id)
        }
      },
      {
        id: 'review-prev',
        label: 'Select Previous Review Task',
        category: 'review',
        hint: 'k',
        keywords: ['review', 'previous', 'navigate'],
        action: () => {
          if (reviewTasksSorted.length === 0) {
            toast.error('No tasks in review')
            return
          }
          const currentIndex = reviewTasksSorted.findIndex((t) => t.id === selectedTaskId)
          const nextIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0)
          const nextTask = reviewTasksSorted[nextIndex]
          if (nextTask) selectTask(nextTask.id)
        }
      },
      {
        id: 'review-batch-select-all',
        label: 'Select All Review Tasks',
        category: 'review',
        keywords: ['review', 'batch', 'select', 'all'],
        action: () => {
          if (reviewTasksSorted.length === 0) {
            toast.error('No tasks in review')
            return
          }
          selectAllBatch(reviewTasksSorted.map((t) => t.id))
          toast.success(`Selected ${reviewTasksSorted.length} tasks`)
        }
      },
      {
        id: 'review-batch-clear',
        label: 'Clear Batch Selection',
        category: 'review',
        keywords: ['review', 'batch', 'clear', 'deselect'],
        action: () => {
          clearBatch()
        }
      }
    ]

    registerCommands(reviewCommands)

    return () => {
      unregisterCommands(reviewCommands.map((c) => c.id))
    }
  }, [
    registerCommands,
    unregisterCommands,
    selectTask,
    selectedTaskId,
    selectAllBatch,
    clearBatch,
    reviewTasksSorted
  ])

  return (
    <ErrorBoundary name="CodeReviewView">
      <motion.div
        className="cr-view"
        variants={VARIANTS.fadeIn}
        initial="initial"
        animate="animate"
        transition={reduced ? REDUCED_TRANSITION : SPRINGS.snappy}
      >
        <GitHubOptedOutBanner />
        <TopBar />
        <div className="cr-panels">
          <FileTreePanel />
          <div className="cr-diffviewer">
            <DiffViewerPanel />
          </div>
          {panelOpen && <AIAssistantPanel />}
        </div>
      </motion.div>
    </ErrorBoundary>
  )
}
