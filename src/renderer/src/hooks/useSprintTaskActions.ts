import { useCallback } from 'react'
import { useSprintTasks } from '../stores/sprintTasks'
import type { CreateTicketInput } from '../stores/sprintTasks'
import { useSprintUI } from '../stores/sprintUI'
import { useSprintSelection } from '../stores/sprintSelection'
import { useConfirm } from '../components/ui/ConfirmModal'
import { toast } from '../stores/toasts'
import { TASK_STATUS } from '../../../shared/constants'
import { detectTemplate } from '../../../shared/template-heuristics'
import { useLaunchTask } from './useLaunchTask'
import {
  createTask as createTaskService,
  retryTask as retryTaskService,
  unblockTask as unblockTaskService,
  forceFailTask as forceFailTaskService,
  forceDoneTask as forceDoneTaskService,
  forceReleaseClaim as forceReleaseClaimService,
  exportTasks as exportTasksService
} from '../services/sprint'
import { killPipelineAgent, triggerDrain as triggerDrainService } from '../services/agentManager'
import type { SprintTask } from '../../../shared/types'

interface SprintTaskActions {
  handleSaveSpec: (taskId: string, spec: string) => Promise<void>
  handleStop: (task: SprintTask) => Promise<void>
  handleRerun: (task: SprintTask) => Promise<void>
  handleRetry: (task: SprintTask) => void
  launchTask: (task: SprintTask) => void
  deleteTask: (id: string) => Promise<void>
  createTask: (data: CreateTicketInput) => Promise<string | null>
  batchDeleteTasks: (taskIds: string[]) => Promise<void>
  unblockTask: (taskId: string) => Promise<void>
  markTaskFailed: (taskId: string, reason?: string) => Promise<void>
  forceTaskDone: (taskId: string) => Promise<void>
  releaseTask: (taskId: string) => Promise<void>
  exportTasks: (
    format: Parameters<typeof exportTasksService>[0]
  ) => Promise<void>
  triggerDrain: () => Promise<void>
  confirmProps: ReturnType<typeof useConfirm>['confirmProps']
}

/**
 * useSprintTaskActions — all task mutation callbacks for SprintCenter.
 * Owns the confirm modal state so callers just spread `confirmProps` onto <ConfirmModal />.
 */
export function useSprintTaskActions(): SprintTaskActions {
  const updateTask = useSprintTasks((s) => s.updateTask)
  const storeDeleteTask = useSprintTasks((s) => s.deleteTask)
  const storeCreateTask = useSprintTasks((s) => s.createTask)
  const storeBatchDeleteTasks = useSprintTasks((s) => s.batchDeleteTasks)
  const generateSpec = useSprintTasks((s) => s.generateSpec)
  const launchTask = useLaunchTask()
  const loadData = useSprintTasks((s) => s.loadData)

  const clearTaskIfSelected = useSprintSelection((s) => s.clearTaskIfSelected)
  const setSelectedTaskId = useSprintSelection((s) => s.setSelectedTaskId)
  const setDrawerOpen = useSprintSelection((s) => s.setDrawerOpen)
  const addGeneratingId = useSprintUI((s) => s.addGeneratingId)
  const removeGeneratingId = useSprintUI((s) => s.removeGeneratingId)

  const { confirm, confirmProps } = useConfirm()

  // --- Save spec from drawer ---
  const handleSaveSpec = useCallback(
    (taskId: string, spec: string) => {
      return updateTask(taskId, { spec })
    },
    [updateTask]
  )

  // --- Stop running agent (with confirm) ---
  const handleStop = useCallback(
    async (task: SprintTask) => {
      if (task.status !== 'active') return
      const ok = await confirm({
        message: 'Stop this agent? The task will be marked cancelled.',
        confirmLabel: 'Stop Agent',
        variant: 'danger'
      })
      if (!ok) return
      try {
        const result = await killPipelineAgent(task.id)
        if (result.ok) {
          updateTask(task.id, { status: TASK_STATUS.CANCELLED })
          toast.success('Agent stopped')
        } else {
          toast.error('Failed to stop agent')
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to stop agent')
      }
    },
    [updateTask, confirm]
  )

  // --- Re-queue a done/failed task as new ticket ---
  const handleRerun = useCallback(
    async (task: SprintTask) => {
      try {
        await createTaskService({
          title: task.title,
          repo: task.repo,
          prompt: task.prompt || task.title,
          spec: task.spec || undefined,
          priority: task.priority,
          status: TASK_STATUS.QUEUED
        })
        toast.success('Task re-queued as new ticket')
        loadData()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to re-queue task')
      }
    },
    [loadData]
  )

  // --- Retry errored/failed task in-place ---
  const handleRetry = useCallback(
    async (task: SprintTask) => {
      const ok = await confirm({
        title: 'Retry Task',
        message: `Retry "${task.title.slice(0, 50)}"? Previous agent work and logs will be cleared.`,
        confirmLabel: 'Retry',
        variant: 'danger'
      })
      if (!ok) return
      try {
        await retryTaskService(task.id)
        toast.success('Task re-queued for retry')
        loadData()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to retry task')
      }
    },
    [confirm, loadData]
  )

  // --- Delete task wrapper (coordinates store + UI) ---
  const deleteTask = useCallback(
    async (taskId: string): Promise<void> => {
      await storeDeleteTask(taskId)
      clearTaskIfSelected(taskId)
    },
    [storeDeleteTask, clearTaskIfSelected]
  )

  // --- Create task wrapper (coordinates store + UI spec generation) ---
  const createTask = useCallback(
    async (data: CreateTicketInput): Promise<string | null> => {
      const taskId = await storeCreateTask(data)

      // Background spec generation for Quick Mode tasks
      if (taskId && !data.spec) {
        const templateHint = detectTemplate(data.title)
        addGeneratingId(taskId)

        generateSpec(taskId, data.title, data.repo.toLowerCase(), templateHint)
          .then(() => {
            toast.info(`Spec ready for "${data.title}"`, {
              action: 'View Spec',
              onAction: () => {
                setSelectedTaskId(taskId)
                setDrawerOpen(true)
              },
              durationMs: 6000
            })
          })
          .finally(() => {
            removeGeneratingId(taskId)
          })
      }

      return taskId
    },
    [
      storeCreateTask,
      generateSpec,
      addGeneratingId,
      removeGeneratingId,
      setSelectedTaskId,
      setDrawerOpen
    ]
  )

  // --- Batch delete tasks wrapper (coordinates store + UI) ---
  const batchDeleteTasks = useCallback(
    async (taskIds: string[]): Promise<void> => {
      await storeBatchDeleteTasks(taskIds)
      taskIds.forEach(clearTaskIfSelected)
    },
    [storeBatchDeleteTasks, clearTaskIfSelected]
  )

  // --- Unblock a blocked task (re-checks dependencies) ---
  const unblockTask = useCallback(async (taskId: string): Promise<void> => {
    try {
      await unblockTaskService(taskId)
      toast.success('Task unblocked - dependencies will be re-checked')
    } catch (err) {
      toast.error(`Failed to unblock: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  // --- Operator override: mark task as failed (audit-trailed reason optional) ---
  const markTaskFailed = useCallback(async (taskId: string, reason?: string): Promise<void> => {
    try {
      await forceFailTaskService({ taskId, reason })
    } catch (err) {
      toast.error(
        `Failed to mark task as failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }, [])

  // --- Operator override: force-mark task as done (resolves dependents) ---
  const forceTaskDone = useCallback(async (taskId: string): Promise<void> => {
    try {
      await forceDoneTaskService({ taskId, force: true })
    } catch (err) {
      toast.error(`Failed to force task done: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  // --- Operator override: force-release a stuck claim so the agent manager re-queues it ---
  const releaseTask = useCallback(async (taskId: string): Promise<void> => {
    try {
      await forceReleaseClaimService(taskId)
      toast.success('Task released — it will be re-queued shortly')
    } catch (err) {
      toast.error(`Failed to release claim: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  // --- Export the full task list to JSON or CSV (Save dialog handled in main) ---
  const exportTasks = useCallback(
    async (format: Parameters<typeof exportTasksService>[0]): Promise<void> => {
      try {
        const result = await exportTasksService(format)
        if (!result.canceled && result.filePath) {
          toast.success('Tasks exported')
        }
      } catch {
        toast.error('Export failed')
      }
    },
    []
  )

  // --- Manually nudge the agent manager drain loop ---
  const triggerDrain = useCallback(async (): Promise<void> => {
    await triggerDrainService()
  }, [])

  return {
    handleSaveSpec,
    handleStop,
    handleRerun,
    handleRetry,
    launchTask,
    deleteTask,
    createTask,
    batchDeleteTasks,
    unblockTask,
    markTaskFailed,
    forceTaskDone,
    releaseTask,
    exportTasks,
    triggerDrain,
    confirmProps
  }
}
