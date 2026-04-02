import type { SprintTask } from '../../../shared/types'
import { TASK_STATUS, PR_STATUS } from '../../../shared/constants'

export interface SprintPartition {
  backlog: SprintTask[]
  todo: SprintTask[]
  blocked: SprintTask[]
  inProgress: SprintTask[]
  awaitingReview: SprintTask[]
  done: SprintTask[]
  failed: SprintTask[]
}

/**
 * Partition sprint tasks into 7 mutually exclusive buckets.
 * Every task lands in exactly one bucket — no overlap.
 *
 * Status mapping:
 *   backlog              → Backlog
 *   queued               → Todo
 *   blocked              → Blocked
 *   active               → In Progress (max 5 enforced at UI layer)
 *   active/done + pr_status=open|branch_only → Awaiting Review
 *   done + pr_status=merged|closed|null|draft → Done
 *   cancelled            → Failed (dimmed at bottom of Done column)
 */
export function partitionSprintTasks(tasks: SprintTask[]): SprintPartition {
  const backlog: SprintTask[] = []
  const todo: SprintTask[] = []
  const blocked: SprintTask[] = []
  const inProgress: SprintTask[] = []
  const awaitingReview: SprintTask[] = []
  const done: SprintTask[] = []
  const failed: SprintTask[] = []

  for (const task of tasks) {
    switch (task.status) {
      case TASK_STATUS.BACKLOG:
        backlog.push(task)
        break
      case TASK_STATUS.QUEUED:
        todo.push(task)
        break
      case TASK_STATUS.BLOCKED:
        blocked.push(task)
        break
      case TASK_STATUS.ACTIVE:
        if (task.pr_status === PR_STATUS.OPEN || task.pr_status === PR_STATUS.BRANCH_ONLY) {
          awaitingReview.push(task)
        } else {
          inProgress.push(task)
        }
        break
      case TASK_STATUS.DONE:
        if (task.pr_status === PR_STATUS.OPEN || task.pr_status === PR_STATUS.BRANCH_ONLY) {
          awaitingReview.push(task)
        } else {
          done.push(task)
        }
        break
      case TASK_STATUS.CANCELLED:
        failed.push(task)
        break
      case TASK_STATUS.FAILED:
        failed.push(task)
        break
      case TASK_STATUS.ERROR:
        failed.push(task)
        break
    }
  }

  // Sort done by completion time descending so .slice(0, N) gets most recent
  done.sort((a, b) => {
    const ta = a.completed_at ?? a.updated_at ?? ''
    const tb = b.completed_at ?? b.updated_at ?? ''
    return tb.localeCompare(ta)
  })

  return { backlog, todo, blocked, inProgress, awaitingReview, done, failed }
}
