import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmModal, useConfirm } from '../ui/ConfirmModal'
import { KanbanBoard } from './KanbanBoard'
import { TaskTable } from './TaskTable'
import { SpecDrawer } from './SpecDrawer'
import { LogDrawer } from './LogDrawer'
import { ConflictDrawer } from './ConflictDrawer'
import { HealthCheckDrawer } from './HealthCheckDrawer'
import { QueueDashboard } from './QueueDashboard'
import { NewTicketModal } from './NewTicketModal'
import { toast } from '../../stores/toasts'
import { usePrConflictsStore } from '../../stores/prConflicts'
import { useHealthCheckStore } from '../../stores/healthCheck'
import { useSprintTasks } from '../../stores/sprintTasks'
import { useSprintUI } from '../../stores/sprintUI'
import { useSprintEvents } from '../../stores/sprintEvents'
import { partitionSprintTasks } from '../../lib/partitionSprintTasks'
import { setOpenLogDrawerTaskId, useTaskToasts } from '../../hooks/useTaskNotifications'
import { useSprintPolling } from '../../hooks/useSprintPolling'
import { usePrStatusPolling } from '../../hooks/usePrStatusPolling'
import { useSprintKeyboardShortcuts } from '../../hooks/useSprintKeyboardShortcuts'
import { useVisibilityAwareInterval } from '../../hooks/useVisibilityAwareInterval'
import {
  POLL_HEALTH_CHECK_MS,
  REPO_OPTIONS,
  WIP_LIMIT_IN_PROGRESS,
} from '../../lib/constants'
import { TASK_STATUS } from '../../../../shared/constants'

import { ErrorBoundary } from '../ui/ErrorBoundary'
import type { SprintTask } from '../../../../shared/types'
export type { SprintTask }

// --- Component ---

export function SprintCenter() {
  // --- Task store state ---
  const tasks = useSprintTasks((s) => s.tasks)
  const loading = useSprintTasks((s) => s.loading)
  const loadError = useSprintTasks((s) => s.loadError)
  const prMergedMap = useSprintTasks((s) => s.prMergedMap)

  const loadData = useSprintTasks((s) => s.loadData)
  const updateTask = useSprintTasks((s) => s.updateTask)
  const deleteTask = useSprintTasks((s) => s.deleteTask)
  const createTask = useSprintTasks((s) => s.createTask)
  const launchTask = useSprintTasks((s) => s.launchTask)

  // --- UI store state ---
  const repoFilter = useSprintUI((s) => s.repoFilter)
  const selectedTaskId = useSprintUI((s) => s.selectedTaskId)
  const logDrawerTaskId = useSprintUI((s) => s.logDrawerTaskId)
  const generatingIds = useSprintUI((s) => s.generatingIds)

  const setRepoFilter = useSprintUI((s) => s.setRepoFilter)
  const setSelectedTaskId = useSprintUI((s) => s.setSelectedTaskId)
  const setLogDrawerTaskId = useSprintUI((s) => s.setLogDrawerTaskId)
  const setGeneratingIds = useSprintUI((s) => s.setGeneratingIds)

  // --- Events store state ---
  const queueHealth = useSprintEvents((s) => s.queueHealth)
  const initTaskOutputListener = useSprintEvents((s) => s.initTaskOutputListener)

  const { confirm, confirmProps } = useConfirm()

  // --- Local UI state ---
  const [backlogSearch, setBacklogSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [conflictDrawerOpen, setConflictDrawerOpen] = useState(false)
  const [healthDrawerOpen, setHealthDrawerOpen] = useState(false)

  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null),
    [selectedTaskId, tasks]
  )
  const logDrawerTask = logDrawerTaskId ? (tasks.find((t) => t.id === logDrawerTaskId) ?? null) : null

  // Subscribe to live task output events
  useEffect(() => {
    const cleanup = initTaskOutputListener()
    return cleanup
  }, [initTaskOutputListener])

  // Bridge custom events from sprintTasks store to sprintUI store
  useEffect(() => {
    const handleGenerating = (e: Event) => {
      const { taskId, generating } = (e as CustomEvent).detail
      setGeneratingIds((prev) => {
        if (generating) {
          if (prev.has(taskId)) return prev
          return new Set(prev).add(taskId)
        } else {
          if (!prev.has(taskId)) return prev
          const next = new Set(prev)
          next.delete(taskId)
          return next
        }
      })
    }
    const handleSelectTask = (e: Event) => {
      const { taskId } = (e as CustomEvent).detail
      setSelectedTaskId(taskId)
    }
    const handleTaskDeleted = (e: Event) => {
      const { taskId } = (e as CustomEvent).detail
      const current = useSprintUI.getState().selectedTaskId
      if (current === taskId) setSelectedTaskId(null)
    }
    window.addEventListener('sprint:generating', handleGenerating)
    window.addEventListener('sprint:select-task', handleSelectTask)
    window.addEventListener('sprint:task-deleted', handleTaskDeleted)
    return () => {
      window.removeEventListener('sprint:generating', handleGenerating)
      window.removeEventListener('sprint:select-task', handleSelectTask)
      window.removeEventListener('sprint:task-deleted', handleTaskDeleted)
    }
  }, [setGeneratingIds, setSelectedTaskId])

  // Keep notification hook aware of which task's LogDrawer is open
  useEffect(() => {
    setOpenLogDrawerTaskId(logDrawerTaskId)
    return () => setOpenLogDrawerTaskId(null)
  }, [logDrawerTaskId])

  // In-app toast notifications for agent-done and PR-opened transitions
  const handleViewOutput = useCallback((task: SprintTask) => {
    setLogDrawerTaskId(task.id)
  }, [setLogDrawerTaskId])
  useTaskToasts(tasks, logDrawerTaskId, handleViewOutput)

  // Extracted polling hooks
  useSprintPolling()
  usePrStatusPolling()
  useSprintKeyboardShortcuts({ setModalOpen, setConflictDrawerOpen })

  const handleDragEnd = useCallback(
    (taskId: string, newStatus: SprintTask['status']) => {
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
    [tasks, updateTask]
  )

  // Within-column reorder (optimistic only — no column_order column in DB yet)
  const setTasks = useSprintTasks((s) => s.setTasks)
  const handleReorder = useCallback(
    (_status: SprintTask['status'], orderedIds: string[]) => {
      const current = useSprintTasks.getState().tasks
      const idOrder = new Map(orderedIds.map((id, i) => [id, i]))
      setTasks([...current].sort((a, b) => {
        const ai = idOrder.get(a.id)
        const bi = idOrder.get(b.id)
        if (ai !== undefined && bi !== undefined) return ai - bi
        return 0
      }))
    },
    [setTasks]
  )

  const handlePushToSprint = useCallback(
    (task: SprintTask) => {
      updateTask(task.id, { status: TASK_STATUS.QUEUED })
      toast.success('Pushed to Sprint')
    },
    [updateTask]
  )

  const handleViewSpec = useCallback(
    (task: SprintTask) => setSelectedTaskId(task.id),
    [setSelectedTaskId]
  )

  const handleSaveSpec = useCallback(
    (taskId: string, spec: string) => {
      updateTask(taskId, { spec })
    },
    [updateTask]
  )

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

  const handleUpdateTitle = useCallback(
    (patch: { id: string; title: string }) => {
      updateTask(patch.id, { title: patch.title })
    },
    [updateTask]
  )

  const conflictingTaskIds = usePrConflictsStore((s) => s.conflictingTaskIds)
  const conflictingTasks = useMemo(
    () => tasks.filter((t) => conflictingTaskIds.has(t.id)),
    [tasks, conflictingTaskIds]
  )

  // Health check — detect stuck active tasks
  const setStuckTasks = useHealthCheckStore((s) => s.setStuckTasks)
  const stuckTaskIds = useHealthCheckStore((s) => s.stuckTaskIds)
  const dismissedIds = useHealthCheckStore((s) => s.dismissedIds)
  const dismissTask = useHealthCheckStore((s) => s.dismiss)

  const runHealthCheck = useCallback(async () => {
    try {
      const stuck = await window.api.sprint.healthCheck()
      setStuckTasks(stuck.map((t) => t.id))
    } catch {
      // silent
    }
  }, [setStuckTasks])

  useEffect(() => { runHealthCheck() }, [runHealthCheck])
  useVisibilityAwareInterval(runHealthCheck, POLL_HEALTH_CHECK_MS)

  const visibleStuckTasks = useMemo(
    () => tasks.filter((t) => stuckTaskIds.has(t.id) && !dismissedIds.has(t.id)),
    [tasks, stuckTaskIds, dismissedIds]
  )

  const filteredTasks = repoFilter
    ? tasks.filter((t) => t.repo.toLowerCase() === repoFilter.toLowerCase())
    : tasks

  const partition = useMemo(() => partitionSprintTasks(filteredTasks), [filteredTasks])

  const filteredBacklog = useMemo(() => {
    if (!backlogSearch.trim()) return partition.backlog
    const q = backlogSearch.trim().toLowerCase()
    return partition.backlog.filter((t) => t.title.toLowerCase().includes(q))
  }, [partition.backlog, backlogSearch])

  const handleUpdatePriority = useCallback(
    (patch: { id: string; priority: number }) => {
      updateTask(patch.id, { priority: patch.priority })
    },
    [updateTask]
  )

  return (
    <div className="sprint-center">
      <div className="sprint-center__header">
        <div className="sprint-center__title-row">
          <span className="sprint-center__title text-gradient-aurora">SPRINT CENTER</span>
          <div className="sprint-board__repo-switcher">
            {REPO_OPTIONS.map((r) => (
              <button
                key={r.label}
                onClick={() => setRepoFilter(repoFilter === r.label ? null : r.label)}
                className={`sprint-board__repo-chip ${repoFilter === r.label ? 'sprint-board__repo-chip--active' : ''}`}
                style={
                  repoFilter === r.label ? { borderColor: r.color, color: r.color } : undefined
                }
              >
                <span className="sprint-board__repo-dot" style={{ background: r.color }} />
                {r.label}
              </button>
            ))}
            <button
              onClick={() => setRepoFilter(null)}
              className={`sprint-board__repo-chip ${repoFilter === null ? 'sprint-board__repo-chip--active' : ''}`}
            >
              All
            </button>
          </div>
        </div>
        <div className="sprint-center__actions">
          {visibleStuckTasks.length > 0 && (
            <button
              className="conflict-badge-btn"
              onClick={() => setHealthDrawerOpen(true)}
              title="Stuck tasks detected"
            >
              <Badge variant="warning" size="sm">
                {visibleStuckTasks.length} stuck
              </Badge>
            </button>
          )}
          {conflictingTasks.length > 0 && (
            <button
              className="conflict-badge-btn"
              onClick={() => setConflictDrawerOpen(true)}
              title="View merge conflicts"
            >
              <Badge variant="danger" size="sm">
                {conflictingTasks.length} conflict{conflictingTasks.length > 1 ? 's' : ''}
              </Badge>
            </button>
          )}
          <kbd className="sprint-center__shortcut-hint" title="Keyboard shortcuts">
            N — New ticket &nbsp; Esc — Close
          </kbd>
          <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>
            + New Ticket
          </Button>
          <Button variant="icon" size="sm" onClick={loadData} disabled={loading} title="Refresh">
            &#x21bb;
          </Button>
        </div>
      </div>

      <QueueDashboard health={queueHealth} />

      <div className="sprint-center__body">
        {loadError && tasks.length === 0 ? (
          <div className="sprint-center__error">
            <p className="sprint-center__error-message">{loadError}</p>
            <Button variant="primary" size="sm" onClick={loadData} disabled={loading}>
              {loading ? 'Retrying…' : 'Retry'}
            </Button>
          </div>
        ) : loading && tasks.length === 0 ? (
          <div className="kanban-board">
            {['To Do', 'In Progress', 'Awaiting Review'].map((label) => (
              <div key={label} className="kanban-col">
                <div className="kanban-col__header">
                  {label} <span className="sprint-col__count bde-count-badge">&mdash;</span>
                </div>
                <div className="kanban-col__cards">
                  <div className="sprint-board__skeleton" />
                  <div className="sprint-board__skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <ErrorBoundary name="KanbanBoard">
            <KanbanBoard
              todoTasks={partition.todo}
              activeTasks={partition.inProgress}
              awaitingReviewTasks={partition.awaitingReview}
              prMergedMap={prMergedMap}
              generatingIds={generatingIds}
              onDragEnd={handleDragEnd}
              onReorder={handleReorder}
              onPushToSprint={handlePushToSprint}
              onLaunch={launchTask}
              onViewSpec={handleViewSpec}
              onViewOutput={handleViewOutput}
              onMarkDone={handleMarkDone}
              onStop={handleStop}
            />
            </ErrorBoundary>

            <div className="bde-backlog-search">
              <input
                type="text"
                className="bde-backlog-search__input"
                placeholder="Search backlog..."
                value={backlogSearch}
                onChange={(e) => setBacklogSearch(e.target.value)}
              />
              {backlogSearch && (
                <button
                  className="bde-backlog-search__clear"
                  onClick={() => setBacklogSearch('')}
                  title="Clear search"
                >
                  &times;
                </button>
              )}
            </div>

            <ErrorBoundary name="Backlog">
            <TaskTable
              section="backlog"
              tasks={filteredBacklog}
              onPushToSprint={handlePushToSprint}
              onViewSpec={handleViewSpec}
              onViewOutput={handleViewOutput}
              onMarkDone={handleMarkDone}
              onUpdate={handleUpdatePriority}
            />
            </ErrorBoundary>

            <ErrorBoundary name="Done Tasks">
            <TaskTable
              section="done"
              tasks={partition.done}
              defaultExpanded={false}
              onPushToSprint={handlePushToSprint}
              onViewSpec={handleViewSpec}
              onViewOutput={handleViewOutput}
              onRerun={handleRerun}
            />
            </ErrorBoundary>

            {partition.failed.length > 0 && (
              <ErrorBoundary name="Failed Tasks">
              <TaskTable
                section="failed"
                tasks={partition.failed}
                defaultExpanded={false}
                onPushToSprint={handlePushToSprint}
                onViewSpec={handleViewSpec}
                onViewOutput={handleViewOutput}
              />
              </ErrorBoundary>
            )}
          </>
        )}
      </div>

      <SpecDrawer
        task={selectedTask}
        onClose={() => setSelectedTaskId(null)}
        onSave={handleSaveSpec}
        onLaunch={launchTask}
        onPushToSprint={handlePushToSprint}
        onMarkDone={handleMarkDone}
        onUpdate={handleUpdateTitle}
        onDelete={deleteTask}
      />

      <NewTicketModal open={modalOpen} onClose={() => setModalOpen(false)} onCreate={createTask} />

      <LogDrawer task={logDrawerTask} onClose={() => setLogDrawerTaskId(null)} onStop={handleStop} onRerun={handleRerun} />

      <ConflictDrawer
        open={conflictDrawerOpen}
        tasks={conflictingTasks}
        onClose={() => setConflictDrawerOpen(false)}
      />

      <HealthCheckDrawer
        open={healthDrawerOpen}
        tasks={visibleStuckTasks}
        onClose={() => setHealthDrawerOpen(false)}
        onDismiss={dismissTask}
      />

      <ConfirmModal {...confirmProps} />
    </div>
  )
}
