import type { SprintTask } from '../../../shared/types'

export interface SprintPartition {
  backlog: SprintTask[]
  todo: SprintTask[]
  inProgress: SprintTask[]
  awaitingReview: SprintTask[]
  done: SprintTask[]
}

/**
 * Partition sprint tasks into 5 mutually exclusive buckets.
 * Every task lands in exactly one bucket — no overlap.
 */
export function partitionSprintTasks(tasks: SprintTask[]): SprintPartition {
  const backlog: SprintTask[] = []
  const todo: SprintTask[] = []
  const inProgress: SprintTask[] = []
  const awaitingReview: SprintTask[] = []
  const done: SprintTask[] = []

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
        done.push(task)
        break
    }
  }

  return { backlog, todo, inProgress, awaitingReview, done }
}
