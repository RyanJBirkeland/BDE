import { useCallback } from 'react'
import { useSprintTasks } from '../stores/sprintTasks'
import { useSprintUI } from '../stores/sprintUI'
import { useConfirm } from '../components/ui/ConfirmModal'
import { toast } from '../stores/toasts'
import { TASK_STATUS } from '../../../shared/constants'
import type { SprintTask } from '../../../shared/types'
import { useTaskWorkbenchStore } from '../stores/taskWorkbench'
import { usePanelLayoutStore } from '../stores/panelLayout'

interface SprintTaskActions {
  handlePushToSprint: (task: SprintTask) => Promise<void>
  handleViewSpec: (task: SprintTask) => void
  handleSaveSpec: (taskId: string, spec: string) => Promise<void>
  handleMarkDone: (task: SprintTask) => Promise<void>
  handleStop: (task: SprintTask) => Promise<void>
  handleRerun: (task: SprintTask) => Promise<void>
  handleUpdateTitle: (patch: { id: string; title: string }) => void
  handleUpdatePriority: (patch: { id: string; priority: number }) => void
  handleRetry: (task: SprintTask) => void
  handleEditInWorkbench: (task: SprintTask) => void
  launchTask: (task: SprintTask) => void
  deleteTask: (id: string) => Promise<void>
  confirmProps: ReturnType<typeof useConfirm>['confirmProps']
}

/**
 * useSprintTaskActions — all task mutation callbacks for SprintCenter.
 * Owns the confirm modal state so callers just spread `confirmProps` onto <ConfirmModal />.
 */
export function useSprintTaskActions(): SprintTaskActions {
  const updateTask = useSprintTasks((s) => s.updateTask)
  const deleteTask = useSprintTasks((s) => s.deleteTask)
  const launchTask = useSprintTasks((s) => s.launchTask)
  const loadData = useSprintTasks((s) => s.loadData)
  const setSelectedTaskId = useSprintUI((s) => s.setSelectedTaskId)

  const { confirm, confirmProps } = useConfirm()

  const loadTask = useTaskWorkbenchStore((s) => s.loadTask)
  const setView = usePanelLayoutStore((s) => s.setView)

  // --- Push backlog task to sprint queue ---
  const handlePushToSprint = useCallback(
    async (task: SprintTask) => {
      try {
        await updateTask(task.id, { status: TASK_STATUS.QUEUED })
        toast.success('Pushed to Sprint')
      } catch (err) {
        toast.error(`Failed to push: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [updateTask]
  )

  // --- Open spec drawer ---
  const handleViewSpec = useCallback(
    (task: SprintTask) => setSelectedTaskId(task.id),
    [setSelectedTaskId]
  )

  // --- Save spec from drawer ---
  const handleSaveSpec = useCallback(
    (taskId: string, spec: string) => {
      return updateTask(taskId, { spec })
    },
    [updateTask]
  )

  // --- Mark task done (with confirm) ---
  const handleMarkDone = useCallback(
    async (task: SprintTask) => {
      const message = task.pr_url
        ? 'Mark as done? The open PR will remain open on GitHub.'
        : 'Mark as done?'
      const ok = await confirm({ message, confirmLabel: 'Mark Done' })
      if (!ok) return
      updateTask(task.id, { status: TASK_STATUS.DONE, completed_at: new Date().toISOString() })
      toast.success('Marked as done')
    },
    [updateTask, confirm]
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

  // --- Inline title edit ---
  const handleUpdateTitle = useCallback(
    (patch: { id: string; title: string }) => {
      updateTask(patch.id, { title: patch.title })
    },
    [updateTask]
  )

  // --- Inline priority edit ---
  const handleUpdatePriority = useCallback(
    (patch: { id: string; priority: number }) => {
      updateTask(patch.id, { priority: patch.priority })
    },
    [updateTask]
  )

  // --- Edit task in workbench ---
  const handleEditInWorkbench = useCallback(
    (task: SprintTask) => {
      loadTask(task)
      setView('task-workbench')
    },
    [loadTask, setView]
  )

  return {
    handlePushToSprint,
    handleViewSpec,
    handleSaveSpec,
    handleMarkDone,
    handleStop,
    handleRerun,
    handleUpdateTitle,
    handleUpdatePriority,
    handleRetry,
    handleEditInWorkbench,
    launchTask,
    deleteTask,
    confirmProps
  }
}
