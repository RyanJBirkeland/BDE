import { timeAgo } from '../../../lib/format'
import type { SprintPartition } from '../../../lib/partitionSprintTasks'
import type { DashboardStats } from '../../../lib/dashboard-types'

export interface StageCell {
  key: string
  label: string
  count: number
  peek: string
}

export function buildStageCells(partitions: SprintPartition, stats: DashboardStats): StageCell[] {
  const oldestActive = partitions.inProgress[partitions.inProgress.length - 1]
  const oldestReview = partitions.pendingReview[partitions.pendingReview.length - 1]
  return [
    {
      key: 'queued',
      label: 'Queued',
      count: partitions.todo.length,
      peek: partitions.todo[0] ? `next: ${partitions.todo[0].title}` : 'queue is empty'
    },
    {
      key: 'running',
      label: 'Running',
      count: partitions.inProgress.length,
      peek: oldestActive
        ? `oldest: ${oldestActive.title} · ${timeAgo(oldestActive.started_at ?? Date.now())}`
        : 'none active'
    },
    {
      key: 'review',
      label: 'Review',
      count: partitions.pendingReview.length,
      peek: oldestReview?.promoted_to_review_at
        ? `oldest: ${timeAgo(oldestReview.promoted_to_review_at)} waiting`
        : 'none pending'
    },
    {
      key: 'done',
      label: 'Done',
      count: partitions.done.length,
      peek: `+${stats.doneToday} today`
    }
  ]
}
