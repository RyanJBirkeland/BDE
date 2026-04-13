/**
 * useSprintPipelineCommands — Registers command palette commands for sprint pipeline operations.
 * Extracted from SprintPipeline.tsx to separate command registration from rendering.
 */
import { useEffect } from 'react'
import { useCommandPaletteStore, type Command } from '../stores/commandPalette'
import { useSprintTasks } from '../stores/sprintTasks'
import { partitionSprintTasks } from '../lib/partitionSprintTasks'
import { toast } from '../stores/toasts'
import type { StatusFilter } from '../stores/sprintUI'
import type { SprintTask } from '../../../shared/types'

export interface UseSprintPipelineCommandsProps {
  openWorkbench: () => void
  handleStop: (task: SprintTask) => void
  handleRetry: (task: SprintTask) => void
  setStatusFilter: (filter: StatusFilter) => void
}

/**
 * Registers sprint pipeline commands in the command palette.
 * Unregisters on cleanup.
 */
export function useSprintPipelineCommands({
  openWorkbench,
  handleStop,
  handleRetry,
  setStatusFilter
}: UseSprintPipelineCommandsProps): void {
  const registerCommands = useCommandPaletteStore((s) => s.registerCommands)
  const unregisterCommands = useCommandPaletteStore((s) => s.unregisterCommands)

  useEffect(() => {
    const taskCommands: Command[] = [
      {
        id: 'task-create',
        label: 'Create New Task',
        category: 'task',
        keywords: ['create', 'new', 'task', 'workbench'],
        action: openWorkbench
      },
      {
        id: 'task-stop-active',
        label: 'Stop Active Task',
        category: 'task',
        keywords: ['stop', 'cancel', 'active'],
        action: () => {
          const currentTasks = useSprintTasks.getState().tasks
          const currentPartition = partitionSprintTasks(currentTasks)
          const activeTask = currentPartition.inProgress[0]
          if (activeTask) {
            handleStop(activeTask)
          } else {
            toast.error('No active task to stop')
          }
        }
      },
      {
        id: 'task-retry-failed',
        label: 'Retry First Failed Task',
        category: 'task',
        keywords: ['retry', 'failed', 'error'],
        action: () => {
          const currentTasks = useSprintTasks.getState().tasks
          const currentPartition = partitionSprintTasks(currentTasks)
          const failedTask = currentPartition.failed[0]
          if (failedTask) {
            handleRetry(failedTask)
          } else {
            toast.error('No failed tasks to retry')
          }
        }
      }
    ]

    const filterCommands: Command[] = [
      {
        id: 'filter-all',
        label: 'Show All Tasks',
        category: 'filter',
        keywords: ['filter', 'all', 'show'],
        action: () => setStatusFilter('all')
      },
      {
        id: 'filter-backlog',
        label: 'Filter: Backlog',
        category: 'filter',
        keywords: ['filter', 'backlog'],
        action: () => setStatusFilter('backlog')
      },
      {
        id: 'filter-todo',
        label: 'Filter: To Do',
        category: 'filter',
        keywords: ['filter', 'todo', 'queued'],
        action: () => setStatusFilter('todo')
      },
      {
        id: 'filter-blocked',
        label: 'Filter: Blocked',
        category: 'filter',
        keywords: ['filter', 'blocked'],
        action: () => setStatusFilter('blocked')
      },
      {
        id: 'filter-active',
        label: 'Filter: In Progress',
        category: 'filter',
        keywords: ['filter', 'active', 'progress'],
        action: () => setStatusFilter('in-progress')
      },
      {
        id: 'filter-review',
        label: 'Filter: Awaiting Review',
        category: 'filter',
        keywords: ['filter', 'review', 'pr'],
        action: () => setStatusFilter('awaiting-review')
      },
      {
        id: 'filter-done',
        label: 'Filter: Done',
        category: 'filter',
        keywords: ['filter', 'done', 'complete'],
        action: () => setStatusFilter('done')
      },
      {
        id: 'filter-failed',
        label: 'Filter: Failed',
        category: 'filter',
        keywords: ['filter', 'failed', 'error'],
        action: () => setStatusFilter('failed')
      }
    ]

    const commands = [...taskCommands, ...filterCommands]
    registerCommands(commands)

    return () => {
      unregisterCommands(commands.map((c) => c.id))
    }
  }, [
    openWorkbench,
    handleStop,
    handleRetry,
    setStatusFilter,
    registerCommands,
    unregisterCommands
  ])
}
