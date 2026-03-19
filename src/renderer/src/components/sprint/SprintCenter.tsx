import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useVisibilityAwareInterval } from '../../hooks/useVisibilityAwareInterval'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { KanbanBoard } from './KanbanBoard'
import { TaskTable } from './TaskTable'
import { SpecDrawer } from './SpecDrawer'
import { LogDrawer } from './LogDrawer'
import { ConflictDrawer } from './ConflictDrawer'
import { HealthCheckDrawer } from './HealthCheckDrawer'
import { PRSection } from './PRSection'
import { NewTicketModal } from './NewTicketModal'
import { toast } from '../../stores/toasts'
import { usePrConflictsStore } from '../../stores/prConflicts'
import { useHealthCheckStore } from '../../stores/healthCheck'
import { useSprintStore } from '../../stores/sprint'
import { partitionSprintTasks } from '../../lib/partitionSprintTasks'
import { subscribeSSE } from '../../lib/taskRunnerSSE'
import { setOpenLogDrawerTaskId, useTaskToasts } from '../../hooks/useTaskNotifications'
import {
  POLL_SPRINT_INTERVAL,
  POLL_SPRINT_ACTIVE_MS,
  POLL_PR_STATUS_MS,
  POLL_HEALTH_CHECK_MS,
  REPO_OPTIONS,
  WIP_LIMIT_IN_PROGRESS,
} from '../../lib/constants'
import { TASK_STATUS, PR_STATUS } from '../../../../shared/constants'

import { ErrorBoundary } from '../ui/ErrorBoundary'
import type { SprintTask } from '../../../../shared/types'
export type { SprintTask }

// --- Component ---

export function SprintCenter() {
  // --- Store state ---
  const tasks = useSprintStore((s) => s.tasks)
  const loading = useSprintStore((s) => s.loading)
  const loadError = useSprintStore((s) => s.loadError)
  const repoFilter = useSprintStore((s) => s.repoFilter)
  const selectedTaskId = useSprintStore((s) => s.selectedTaskId)
  const logDrawerTaskId = useSprintStore((s) => s.logDrawerTaskId)
  const prMergedMap = useSprintStore((s) => s.prMergedMap)
  const generatingIds = useSprintStore((s) => s.generatingIds)

  const loadData = useSprintStore((s) => s.loadData)
  const updateTask = useSprintStore((s) => s.updateTask)
  const deleteTask = useSprintStore((s) => s.deleteTask)
  const createTask = useSprintStore((s) => s.createTask)
  const mergeSseUpdate = useSprintStore((s) => s.mergeSseUpdate)
  const setRepoFilter = useSprintStore((s) => s.setRepoFilter)
  const setSelectedTaskId = useSprintStore((s) => s.setSelectedTaskId)
  const setLogDrawerTaskId = useSprintStore((s) => s.setLogDrawerTaskId)
  const setPrMergedMap = useSprintStore((s) => s.setPrMergedMap)

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

  // Adaptive sprint polling — consistency backstop (SSE handles real-time)
  const hasActiveTasks = tasks.some((t) => t.status === TASK_STATUS.ACTIVE)
  const sprintPollMs = hasActiveTasks ? POLL_SPRINT_ACTIVE_MS : POLL_SPRINT_INTERVAL

  useEffect(() => { loadData() }, [loadData])
  useVisibilityAwareInterval(loadData, sprintPollMs)

  // Instant refresh when an external process writes to bde.db
  useEffect(() => {
    window.api.onExternalSprintChange(loadData)
    return () => window.api.offExternalSprintChange(loadData)
  }, [loadData])

  // Real-time task updates via SSE singleton — surgical merge + debounced backstop
  const debouncedLoadRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedLoadData = useMemo(
    () => () => {
      if (debouncedLoadRef.current) clearTimeout(debouncedLoadRef.current)
      debouncedLoadRef.current = setTimeout(loadData, 300)
    },
    [loadData]
  )

  useEffect(() => {
    const unsub = subscribeSSE('task:updated', (data: unknown) => {
      const raw = data as Record<string, unknown>
      mergeSseUpdate({ ...raw, taskId: (raw.taskId ?? raw.id) as string })
      debouncedLoadData()
    })
    return () => {
      unsub()
      if (debouncedLoadRef.current) clearTimeout(debouncedLoadRef.current)
    }
  }, [mergeSseUpdate, debouncedLoadData])

  // PR status polling — check merged status for tasks with a pr_url
  const prMergedRef = useRef(prMergedMap)
  prMergedRef.current = prMergedMap
  const updateTaskRef = useRef(updateTask)
  updateTaskRef.current = updateTask

  const setConflicts = usePrConflictsStore((s) => s.setConflicts)
  const prevConflictIdsRef = useRef<Set<string>>(new Set())
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  const pollPrStatuses = useCallback(async (taskList: SprintTask[]) => {
    const withPr = taskList.filter((t) => t.pr_url && !prMergedRef.current[t.id])
    if (withPr.length === 0) return
    try {
      const results = await window.api.pollPrStatuses(
        withPr.map((t) => ({ taskId: t.id, prUrl: t.pr_url! }))
      )
      setPrMergedMap((prev) => {
        let changed = false
        for (const r of results) {
          if (prev[r.taskId] !== r.merged) { changed = true; break }
        }
        if (!changed) return prev
        const next = { ...prev }
        for (const r of results) next[r.taskId] = r.merged
        return next
      })
      // Write pr_status='merged' back so tasks leave Awaiting Review
      for (const r of results) {
        if (r.merged) updateTaskRef.current(r.taskId, { pr_status: PR_STATUS.MERGED })
      }

      // Track merge conflicts
      const conflicting = results.filter((r) => r.mergeableState === 'dirty' && !r.merged)
      const conflictIds = conflicting.map((r) => r.taskId)
      setConflicts(conflictIds)

      // Toast when NEW conflicts appear
      const prev = prevConflictIdsRef.current
      const newConflicts = conflictIds.filter((id) => !prev.has(id))
      if (newConflicts.length > 0) {
        toast.error(`${newConflicts.length} PR${newConflicts.length > 1 ? 's have' : ' has'} merge conflicts`)
      }
      prevConflictIdsRef.current = new Set(conflictIds)

      // Persist mergeable state to SQLite
      for (const r of results) {
        if (r.mergeableState) {
          updateTaskRef.current(r.taskId, { pr_mergeable_state: r.mergeableState as SprintTask['pr_mergeable_state'] })
        }
      }
    } catch {
      // gh CLI unavailable — degrade gracefully
    }
  }, [setConflicts, setPrMergedMap])

  const pollPrStatusesCurrent = useCallback(() => pollPrStatuses(tasksRef.current), [pollPrStatuses])
  useEffect(() => { pollPrStatusesCurrent() }, [pollPrStatusesCurrent])
  useVisibilityAwareInterval(pollPrStatusesCurrent, POLL_PR_STATUS_MS)

  // Detect active→done transitions and trigger immediate PR poll
  const prevTasksRef = useRef<SprintTask[]>([])
  useEffect(() => {
    const prev = prevTasksRef.current
    prevTasksRef.current = tasks
    if (prev.length === 0) return
    const justDone = tasks.filter(
      (t) => t.status === TASK_STATUS.DONE && t.pr_url && prev.find((p) => p.id === t.id)?.status === TASK_STATUS.ACTIVE
    )
    if (justDone.length > 0) pollPrStatuses(justDone)
  }, [tasks, pollPrStatuses])

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
  const setTasks = useSprintStore((s) => s.setTasks)
  const handleReorder = useCallback(
    (_status: SprintTask['status'], orderedIds: string[]) => {
      const current = useSprintStore.getState().tasks
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

  const handleLaunch = useCallback(
    async (task: SprintTask) => {
      // Block launch when WIP limit reached (unless task is already active)
      if (task.status !== TASK_STATUS.ACTIVE) {
        const activeCount = tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length
        if (activeCount >= WIP_LIMIT_IN_PROGRESS) {
          toast.error(`In Progress is full (${WIP_LIMIT_IN_PROGRESS}/${WIP_LIMIT_IN_PROGRESS}) — finish or stop a task first`)
          return
        }
      }

      try {
        const repoPaths = await window.api.getRepoPaths()
        const repoPath = repoPaths[task.repo.toLowerCase()] ?? repoPaths[task.repo]
        if (!repoPath) {
          toast.error(`No repo path configured for "${task.repo}"`)
          return
        }

        const result = await window.api.spawnLocalAgent({
          task: task.spec ?? task.title,
          repoPath,
        })

        updateTask(task.id, {
          status: TASK_STATUS.ACTIVE,
          agent_run_id: result.id,
          started_at: new Date().toISOString(),
        })
        toast.success('Agent launched')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to launch agent')
      }
    },
    [tasks, updateTask]
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
    (task: SprintTask) => {
      const message = task.pr_url
        ? 'Mark as done? The open PR will remain open on GitHub.'
        : 'Mark as done?'
      if (!confirm(message)) return
      updateTask(task.id, { status: TASK_STATUS.DONE, completed_at: new Date().toISOString() })
      toast.success('Marked as done')
    },
    [updateTask]
  )

  const handleStop = useCallback(
    async (task: SprintTask) => {
      if (!task.agent_run_id) return
      const confirmed = window.confirm('Stop this agent? The task will be marked cancelled.')
      if (!confirmed) return
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
    [updateTask]
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

  // Keyboard shortcuts: N → new ticket, Escape → close drawers/modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // If SpecDrawer is open, let it handle Escape (unsaved-changes guard)
        if (selectedTaskId) return
        setLogDrawerTaskId(null)
        setModalOpen(false)
        setConflictDrawerOpen(false)
        return
      }

      if (
        e.key === 'n' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault()
        setModalOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskId, setLogDrawerTaskId])

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
              onLaunch={handleLaunch}
              onViewSpec={handleViewSpec}
              onViewOutput={handleViewOutput}
              onMarkDone={handleMarkDone}
              onStop={handleStop}
            />
            </ErrorBoundary>

            <ErrorBoundary name="Done Tasks">
            <TaskTable
              section="done"
              tasks={partition.done}
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
                onPushToSprint={handlePushToSprint}
                onViewSpec={handleViewSpec}
                onViewOutput={handleViewOutput}
              />
              </ErrorBoundary>
            )}
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
          </>
        )}
      </div>

      <ErrorBoundary name="PR Section">
      <PRSection />
      </ErrorBoundary>

      <SpecDrawer
        task={selectedTask}
        onClose={() => setSelectedTaskId(null)}
        onSave={handleSaveSpec}
        onLaunch={handleLaunch}
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
    </div>
  )
}
