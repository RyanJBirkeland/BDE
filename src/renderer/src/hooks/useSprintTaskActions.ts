import { useCallback } from 'react'
import { useSprintTasks } from '../stores/sprintTasks'
import { useSprintUI } from '../stores/sprintUI'
import { useConfirm } from '../components/ui/ConfirmModal'
import { toast } from '../stores/toasts'
import { TASK_STATUS } from '../../../shared/constants'
import { WIP_LIMIT_IN_PROGRESS } from '../lib/constants'
import type { SprintTask } from '../../../shared/types'
import { useTaskWorkbenchStore } from '../stores/taskWorkbench'
import { useUIStore } from '../stores/ui'

/**
 * useSprintTaskActions — all task mutation callbacks for SprintCenter.
 * Owns the confirm modal state so callers just spread `confirmProps` onto <ConfirmModal />.
 */
export function useSprintTaskActions() {
  const updateTask = useSprintTasks((s) => s.updateTask)
  const deleteTask = useSprintTasks((s) => s.deleteTask)
  const launchTask = useSprintTasks((s) => s.launchTask)
  const loadData = useSprintTasks((s) => s.loadData)
  const setSelectedTaskId = useSprintUI((s) => s.setSelectedTaskId)
  const setTasks = useSprintTasks((s) => s.setTasks)

  const { confirm, confirmProps } = useConfirm()

  const loadTask = useTaskWorkbenchStore((s) => s.loadTask)
  const setView = useUIStore((s) => s.setView)

  // --- Drag-and-drop status change (needs current tasks for WIP check) ---
  const handleDragEnd = useCallback(
    (taskId: string, newStatus: SprintTask['status'], tasks: SprintTask[]) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task || task.status === newStatus) return
      // Block transitions into In Progress when WIP limit reached
      if (newStatus === TASK_STATUS.ACTIVE && task.status !== TASK_STATUS.ACTIVE) {
        const activeCount = tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length
        if (activeCount >= WIP_LIMIT_IN_PROGRESS) {
          toast.error(`In Progress is full (${WIP_LIMIT_IN_PROGRESS}/${WIP_LIMIT_IN_PROGRESS})`)
          return
        }
      }
      updateTask(taskId, { status: newStatus })
    },
    [updateTask]
  )

  // --- Within-column reorder (optimistic only — no column_order column in DB yet) ---
  const handleReorder = useCallback(
    (_status: SprintTask['status'], orderedIds: string[]) => {
      const current = useSprintTasks.getState().tasks
      const idOrder = new Map(orderedIds.map((id, i) => [id, i]))
      setTasks(
        [...current].sort((a, b) => {
          const ai = idOrder.get(a.id)
          const bi = idOrder.get(b.id)
          if (ai !== undefined && bi !== undefined) return ai - bi
          return 0
        })
      )
    },
    [setTasks]
  )

  // --- Push backlog task to sprint queue ---
  const handlePushToSprint = useCallback(
    (task: SprintTask) => {
      updateTask(task.id, { status: TASK_STATUS.QUEUED })
      toast.success('Pushed to Sprint')
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
      updateTask(taskId, { spec })
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
      if (!task.agent_run_id) return
      const ok = await confirm({
        message: 'Stop this agent? The task will be marked cancelled.',
        confirmLabel: 'Stop Agent',
        variant: 'danger'
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
    handleDragEnd,
    handleReorder,
    handlePushToSprint,
    handleViewSpec,
    handleSaveSpec,
    handleMarkDone,
    handleStop,
    handleRerun,
    handleUpdateTitle,
    handleUpdatePriority,
    handleEditInWorkbench,
    launchTask,
    deleteTask,
    confirmProps
  }
}
