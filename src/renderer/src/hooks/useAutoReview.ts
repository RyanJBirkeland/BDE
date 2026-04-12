import { useEffect } from 'react'
import { useReviewPartnerActions } from './useReviewPartnerActions'
import type { SprintTask } from '../../../shared/types/task-types'

type TaskStatus = SprintTask['status']

const DEBOUNCE_MS = 2000

/**
 * Debounces an auto-review fire when the user selects a task in review status.
 * Rapid task switches cancel the pending fire — only the last stable selection
 * triggers a review.
 */
export function useAutoReview(taskId: string | null, taskStatus: TaskStatus | null): void {
  const { autoReview } = useReviewPartnerActions()

  useEffect(() => {
    if (!taskId || taskStatus !== 'review') return
    const handle = setTimeout(() => {
      autoReview(taskId).catch(() => {
        // errors surface via store.reviewByTask[taskId].error; swallow here
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [taskId, taskStatus, autoReview])
}
