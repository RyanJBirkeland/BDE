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
 *   done + pr_status=open → Awaiting Review
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
        if (task.pr_status === PR_STATUS.OPEN) {
          awaitingReview.push(task)
        } else {
          inProgress.push(task)
        }
        break
      case TASK_STATUS.DONE:
        if (task.pr_status === PR_STATUS.OPEN) {
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

  return { backlog, todo, blocked, inProgress, awaitingReview, done, failed }
}
