import { useCallback } from 'react'
import { useSprintTasks } from '../stores/sprintTasks'
import type { CreateTicketInput } from '../stores/sprintTasks'
import { useSprintUI } from '../stores/sprintUI'
import { useConfirm } from '../components/ui/ConfirmModal'
import { toast } from '../stores/toasts'
import { TASK_STATUS } from '../../../shared/constants'
import { detectTemplate } from '../../../shared/template-heuristics'
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
  const launchTask = useSprintTasks((s) => s.launchTask)
  const loadData = useSprintTasks((s) => s.loadData)

  const clearTaskIfSelected = useSprintUI((s) => s.clearTaskIfSelected)
  const addGeneratingId = useSprintUI((s) => s.addGeneratingId)
  const removeGeneratingId = useSprintUI((s) => s.removeGeneratingId)
  const setSelectedTaskId = useSprintUI((s) => s.setSelectedTaskId)
  const setDrawerOpen = useSprintUI((s) => s.setDrawerOpen)

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
        const result = await window.api.agentManager.kill(task.id)
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
        await window.api.sprint.create({
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
        await window.api.sprint.retry(task.id)
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

  return {
    handleSaveSpec,
    handleStop,
    handleRerun,
    handleRetry,
    launchTask,
    deleteTask,
    createTask,
    batchDeleteTasks,
    confirmProps
  }
}
