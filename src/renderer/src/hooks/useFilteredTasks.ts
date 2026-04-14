import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSprintTasks } from '../stores/sprintTasks'
import { useSprintFilters, type StatusFilter } from '../stores/sprintFilters'
import { partitionSprintTasks, type SprintPartition } from '../lib/partitionSprintTasks'
import { parseTaskQuery, applyPredicates } from '../lib/task-query'
import type { SprintTask } from '../../../shared/types'

interface FilteredTasksResult {
  filteredTasks: SprintTask[]
  filteredPartition: SprintPartition
  partition: SprintPartition
  statusFilter: StatusFilter
}

/**
 * Derives filtered task partitions from sprint store + UI filter state.
 * Encapsulates the status-filter → partition-zeroing logic.
 */
export function useFilteredTasks(): FilteredTasksResult {
  const tasks = useSprintTasks((s) => s.tasks)

  const { statusFilter, repoFilter, tagFilter, searchQuery } = useSprintFilters(
    useShallow((s) => ({
      statusFilter: s.statusFilter,
      repoFilter: s.repoFilter,
      tagFilter: s.tagFilter,
      searchQuery: s.searchQuery
    }))
  )

  // Apply UI chip filters
  const filteredTasks = useMemo(() => {
    let result = tasks
    if (repoFilter) result = result.filter((t) => t.repo === repoFilter)
    if (tagFilter) result = result.filter((t) => t.tags?.includes(tagFilter))
    // Apply structured query language
    if (searchQuery) {
      const predicates = parseTaskQuery(searchQuery)
      result = applyPredicates(result, predicates)
    }
    return result
  }, [tasks, repoFilter, tagFilter, searchQuery])

  const partition = useMemo(() => partitionSprintTasks(filteredTasks), [filteredTasks])

  // Apply status filter to partition buckets
  const filteredPartition = useMemo(() => {
    if (statusFilter === 'all') return partition

    const emptyBucket: SprintTask[] = []
    switch (statusFilter) {
      case 'backlog':
        return {
          ...partition,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          awaitingReview: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'todo':
        return {
          ...partition,
          backlog: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          awaitingReview: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'blocked':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          inProgress: emptyBucket,
          awaitingReview: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'in-progress':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          awaitingReview: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'awaiting-review':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          done: emptyBucket,
          failed: emptyBucket
        }
      case 'done':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          awaitingReview: emptyBucket,
          failed: emptyBucket
        }
      case 'failed':
        return {
          ...partition,
          backlog: emptyBucket,
          todo: emptyBucket,
          blocked: emptyBucket,
          inProgress: emptyBucket,
          awaitingReview: emptyBucket,
          done: emptyBucket
        }
      default:
        return partition
    }
  }, [partition, statusFilter])

  return {
    filteredTasks,
    filteredPartition,
    partition,
    statusFilter
  }
}
