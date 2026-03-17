import type { SprintTask } from '../../../shared/types'

export interface SprintPartition {
  backlog: SprintTask[]
  todo: SprintTask[]
  inProgress: SprintTask[]
  awaitingReview: SprintTask[]
  done: SprintTask[]
  failed: SprintTask[]
}

/**
 * Partition sprint tasks into 6 mutually exclusive buckets.
 * Every task lands in exactly one bucket — no overlap.
 *
 * Status mapping:
 *   backlog              → Backlog
 *   queued               → Todo
 *   active               → In Progress (max 5 enforced at UI layer)
 *   done + pr_status=open → Awaiting Review
 *   done + pr_status=merged|closed|null|draft → Done
 *   cancelled            → Failed (dimmed at bottom of Done column)
 */
export function partitionSprintTasks(tasks: SprintTask[]): SprintPartition {
  const backlog: SprintTask[] = []
  const todo: SprintTask[] = []
  const inProgress: SprintTask[] = []
  const awaitingReview: SprintTask[] = []
  const done: SprintTask[] = []
  const failed: SprintTask[] = []

  for (const task of tasks) {
    switch (task.status) {
      case 'backlog':
        backlog.push(task)
        break
      case 'queued':
        todo.push(task)
        break
      case 'active':
        inProgress.push(task)
        break
      case 'done':
        if (task.pr_status === 'open') {
          awaitingReview.push(task)
        } else {
          done.push(task)
        }
        break
      case 'cancelled':
        failed.push(task)
        break
    }
  }

  return { backlog, todo, inProgress, awaitingReview, done, failed }
}
