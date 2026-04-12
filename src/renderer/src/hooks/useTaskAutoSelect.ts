import { useEffect } from 'react'
import { useCodeReviewStore } from '../stores/codeReview'
import { useSprintTasks } from '../stores/sprintTasks'

/**
 * Auto-select the first review task when the current selection is stale
 * (e.g. after Ship It marked it `done`) or missing. Without this, the
 * TopBar falls into its empty state any time the previously-selected task
 * leaves review status, even if another task is available — which blocks
 * the user from shipping anything more without manually reopening the
 * task switcher popover. Runs whenever `tasks` updates (poll merge + file
 * watcher `sprint:externalChange` events).
 */
export function useTaskAutoSelect(): void {
  const selectedTaskId = useCodeReviewStore((s) => s.selectedTaskId)
  const selectTask = useCodeReviewStore((s) => s.selectTask)
  const tasks = useSprintTasks((s) => s.tasks)

  const task = tasks.find((t) => t.id === selectedTaskId)
  const isValidSelection = !!task && task.status === 'review'

  useEffect(() => {
    if (isValidSelection) return
    const firstReview = tasks
      .filter((t) => t.status === 'review')
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]
    if (firstReview) selectTask(firstReview.id)
  }, [isValidSelection, tasks, selectTask])
}
