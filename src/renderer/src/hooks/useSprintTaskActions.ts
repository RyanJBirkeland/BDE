/**
 * useSprintTaskActions — task lifecycle callbacks extracted from SprintCenter.
 * Handles mark-done, stop, rerun, and delete with confirmation dialogs.
 */
import { useCallback } from 'react'
import { useSprintTasks } from '../stores/sprintTasks'
import { useConfirm } from '../components/ui/ConfirmModal'
import { toast } from '../stores/toasts'
import { TASK_STATUS } from '../../../shared/constants'
import type { SprintTask } from '../../../shared/types'

export function useSprintTaskActions() {
  const updateTask = useSprintTasks((s) => s.updateTask)
  const deleteTask = useSprintTasks((s) => s.deleteTask)
  const launchTask = useSprintTasks((s) => s.launchTask)
  const loadData = useSprintTasks((s) => s.loadData)

  const { confirm, confirmProps } = useConfirm()

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

  const handleStop = useCallback(
    async (task: SprintTask) => {
      if (!task.agent_run_id) return
      const ok = await confirm({
        message: 'Stop this agent? The task will be marked cancelled.',
        confirmLabel: 'Stop Agent',
        variant: 'danger',
      })
      if (!ok) return
      try {
        const result = await window.api.killAgent(task.agent_run_id)
        if (result.ok) {
          updateTask(task.id, { status: TASK_STATUS.CANCELLED })
          toast.success('Agent stopped')
        } else {
          toast.error(result.error ?? 'Failed to stop agent')
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to stop agent')
      }
    },
    [updateTask, confirm]
  )

  const handleRerun = useCallback(
    async (task: SprintTask) => {
      try {
        await window.api.sprint.create({
          title: task.title,
          repo: task.repo,
          prompt: task.prompt || task.title,
          spec: task.spec || undefined,
          priority: task.priority,
          status: TASK_STATUS.QUEUED,
        })
        toast.success('Task re-queued as new ticket')
        loadData()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to re-queue task')
      }
    },
    [loadData]
  )

  const handleDelete = useCallback(
    async (taskId: string) => {
      const ok = await confirm({
        message: 'Delete this task? This cannot be undone.',
        confirmLabel: 'Delete',
        variant: 'danger',
      })
      if (!ok) return
      deleteTask(taskId)
    },
    [deleteTask, confirm]
  )

  return {
    handleMarkDone,
    handleStop,
    handleRerun,
    handleDelete,
    handleLaunch: launchTask,
    confirmProps,
  }
}
