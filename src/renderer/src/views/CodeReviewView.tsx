import { useEffect } from 'react'
import { ReviewQueue } from '../components/code-review/ReviewQueue'
import { ReviewDetail } from '../components/code-review/ReviewDetail'
import { ReviewActions } from '../components/code-review/ReviewActions'
import { BatchActions } from '../components/code-review/BatchActions'
import { useCommandPaletteStore, type Command } from '../stores/commandPalette'
import { useCodeReviewStore } from '../stores/codeReview'
import { useSprintTasks } from '../stores/sprintTasks'
import { toast } from '../stores/toasts'

export default function CodeReviewView(): React.JSX.Element {
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands)
  const unregisterCommands = useCommandPaletteStore((s) => s.unregisterCommands)
  const selectTask = useCodeReviewStore((s) => s.selectTask)
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const selectAllBatch = useCodeReviewStore((s) => s.selectAllBatch)
  const clearBatch = useCodeReviewStore((s) => s.clearBatch)
  const tasks = useSprintTasks((s) => s.tasks)

  useEffect(() => {
    const reviewCommands: Command[] = [
      {
        id: 'review-next',
        label: 'Select Next Review Task',
        category: 'review',
        hint: 'j',
        keywords: ['review', 'next', 'navigate'],
        action: () => {
          const reviewTasks = tasks
            .filter((t) => t.status === 'review')
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          if (reviewTasks.length === 0) {
            toast.error('No tasks in review')
            return
          }
          const currentIndex = reviewTasks.findIndex((t) => t.id === selectedTaskId)
          const nextIndex =
            currentIndex === -1 ? 0 : Math.min(currentIndex + 1, reviewTasks.length - 1)
          selectTask(reviewTasks[nextIndex].id)
        }
      },
      {
        id: 'review-prev',
        label: 'Select Previous Review Task',
        category: 'review',
        hint: 'k',
        keywords: ['review', 'previous', 'navigate'],
        action: () => {
          const reviewTasks = tasks
            .filter((t) => t.status === 'review')
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          if (reviewTasks.length === 0) {
            toast.error('No tasks in review')
            return
          }
          const currentIndex = reviewTasks.findIndex((t) => t.id === selectedTaskId)
          const nextIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0)
          selectTask(reviewTasks[nextIndex].id)
        }
      },
      {
        id: 'review-batch-select-all',
        label: 'Select All Review Tasks',
        category: 'review',
        keywords: ['review', 'batch', 'select', 'all'],
        action: () => {
          const reviewTasks = tasks.filter((t) => t.status === 'review')
          if (reviewTasks.length === 0) {
            toast.error('No tasks in review')
            return
          }
          selectAllBatch(reviewTasks.map((t) => t.id))
          toast.success(`Selected ${reviewTasks.length} tasks`)
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
    tasks
  ])

  return (
    <div className="cr-view">
      <ReviewQueue />
      <BatchActions />
      <div className="cr-main">
        <ReviewDetail />
        <ReviewActions />
      </div>
    </div>
  )
}
