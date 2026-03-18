import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
import type { CreateTicketData } from './NewTicketModal'
import { toast } from '../../stores/toasts'
import { usePrConflictsStore } from '../../stores/prConflicts'
import { useHealthCheckStore } from '../../stores/healthCheck'
import { detectTemplate } from '../../../../shared/template-heuristics'
import { partitionSprintTasks } from '../../lib/partitionSprintTasks'
import { subscribeSSE, type TaskUpdatedEvent } from '../../lib/taskRunnerSSE'
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

const REPO_LABEL_TO_ENUM: Record<string, string> = {
  BDE: 'bde',
  'life-os': 'life-os',
  feast: 'feast',
}

// --- Types ---

import type { SprintTask } from '../../../../shared/types'
export type { SprintTask }

// --- Component ---

export default function SprintCenter() {
  const [tasks, setTasks] = useState<SprintTask[]>([])
  const [repoFilter, setRepoFilter] = useState<string | null>(null)
  const [backlogSearch, setBacklogSearch] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [logDrawerTaskId, setLogDrawerTaskId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [prMergedMap, setPrMergedMap] = useState<Record<string, boolean>>({})
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set())
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
  }, [])
  useTaskToasts(tasks, logDrawerTaskId, handleViewOutput)

  const prevTasksRef = useRef<SprintTask[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async () => {
    setLoadError(null)
    setLoading(true)
    try {
      const result = (await window.api.sprint.list()) as SprintTask[]
      const next = Array.isArray(result) ? result : []
      setTasks((prev) => {
        prevTasksRef.current = prev
        return next
      })
    } catch (e) {
      setLoadError('Failed to load tasks — ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false)
    }
  }, [])

  // Adaptive sprint polling — consistency backstop (SSE handles real-time)
  const hasActiveTasks = tasks.some((t) => t.status === TASK_STATUS.ACTIVE)

  useEffect(() => {
    loadData()
    const ms = hasActiveTasks ? POLL_SPRINT_ACTIVE_MS : POLL_SPRINT_INTERVAL
    intervalRef.current = setInterval(loadData, ms)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [loadData, hasActiveTasks])

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
      const update = data as TaskUpdatedEvent
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== update.id) return t
          const merged = { ...t, ...update }
          // Optimistic: when a task becomes done with a pr_url, ensure pr_status='open'
          // so it immediately appears in Awaiting Review (don't wait for pollPrStatuses)
          if (merged.status === TASK_STATUS.DONE && merged.pr_url && !merged.pr_status) {
            merged.pr_status = PR_STATUS.OPEN
          }
          return merged
        })
      )
      debouncedLoadData()
    })
    return () => {
      unsub()
      if (debouncedLoadRef.current) clearTimeout(debouncedLoadRef.current)
    }
  }, [debouncedLoadData])

  // PR status polling — check merged status for tasks with a pr_url
  const prMergedRef = useRef(prMergedMap)
  prMergedRef.current = prMergedMap
  const updateTaskRef = useRef<(taskId: string, patch: Partial<SprintTask>) => Promise<void>>(
    async () => undefined
  )

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
  }, [setConflicts])

  useEffect(() => {
    pollPrStatuses(tasksRef.current)
    prIntervalRef.current = setInterval(() => pollPrStatuses(tasksRef.current), POLL_PR_STATUS_MS)
    return () => {
      if (prIntervalRef.current) clearInterval(prIntervalRef.current)
    }
  }, [pollPrStatuses])

  // Detect active→done transitions and trigger immediate PR poll
  useEffect(() => {
    const prev = prevTasksRef.current
    if (prev.length === 0) return
    const justDone = tasks.filter(
      (t) => t.status === TASK_STATUS.DONE && t.pr_url && prev.find((p) => p.id === t.id)?.status === TASK_STATUS.ACTIVE
    )
    if (justDone.length > 0) pollPrStatuses(justDone)
  }, [tasks, pollPrStatuses])

  const updateTask = useCallback(
    async (taskId: string, patch: Partial<SprintTask>): Promise<void> => {
      // Optimistic update — selectedTask derives from tasks automatically
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, ...patch, updated_at: new Date().toISOString() } : t
        )
      )

      try {
        await window.api.sprint.update(taskId, patch)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to update task')
        loadData() // revert optimistic on failure
      }
    },
    [loadData]
  )
  updateTaskRef.current = updateTask

  const createTask = useCallback(
    async (data: CreateTicketData) => {
      const repoEnum = REPO_LABEL_TO_ENUM[data.repo] ?? data.repo.toLowerCase()

      // Optimistic insert so the card appears immediately
      const optimistic: SprintTask = {
        id: `temp-${Date.now()}`,
        title: data.title,
        repo: repoEnum,
        priority: data.priority,
        status: TASK_STATUS.BACKLOG,
        notes: null,
        spec: data.spec || null,
        prompt: data.prompt || data.title,
        agent_run_id: null,
        pr_number: null,
        pr_status: null,
        pr_mergeable_state: null,
        pr_url: null,
        started_at: null,
        completed_at: null,
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }
      setTasks((prev) => [optimistic, ...prev])

      try {
        const result = (await window.api.sprint.create({
          title: data.title,
          repo: repoEnum,
          prompt: data.prompt || data.title,
          notes: data.notes || undefined,
          spec: data.spec || undefined,
          priority: data.priority,
          status: TASK_STATUS.BACKLOG,
        })) as SprintTask

        // Replace optimistic with server row
        if (result?.id) {
          setTasks((prev) => prev.map((t) => (t.id === optimistic.id ? result : t)))

          // Trigger background spec generation for Quick Mode tasks (no spec yet)
          if (!data.spec) {
            const templateHint = detectTemplate(data.title)
            setGeneratingIds((prev) => {
              if (prev.has(result.id)) return prev
              return new Set(prev).add(result.id)
            })

            window.api.sprint
              .generatePrompt({
                taskId: result.id,
                title: data.title,
                repo: repoEnum,
                templateHint,
              })
              .then((genResult) => {
                setTasks((prev) =>
                  prev.map((t) =>
                    t.id === genResult.taskId
                      ? { ...t, spec: genResult.spec || null, prompt: genResult.prompt }
                      : t
                  )
                )
                toast.info(`Spec ready for "${data.title}"`, {
                  action: 'View Spec',
                  onAction: () => setSelectedTaskId(result.id),
                  durationMs: 6000,
                })
              })
              .catch((e: unknown) => {
                toast.error('Spec generation failed: ' + (e instanceof Error ? e.message : String(e)))
              })
              .finally(() => {
                setGeneratingIds((prev) => {
                  if (!prev.has(result.id)) return prev
                  const next = new Set(prev)
                  next.delete(result.id)
                  return next
                })
              })
          }
        }
        toast.success('Ticket created — saved to Backlog')
      } catch (e) {
        // Remove optimistic on failure
        setTasks((prev) => prev.filter((t) => t.id !== optimistic.id))
        toast.error(e instanceof Error ? e.message : 'Failed to create task')
      }
    },
    []
  )

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
  const handleReorder = useCallback(
    (_status: SprintTask['status'], orderedIds: string[]) => {
      setTasks((prev) => {
        const idOrder = new Map(orderedIds.map((id, i) => [id, i]))
        return [...prev].sort((a, b) => {
          const ai = idOrder.get(a.id)
          const bi = idOrder.get(b.id)
          if (ai !== undefined && bi !== undefined) return ai - bi
          return 0
        })
      })
    },
    []
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
    []
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
      const result = await window.api.killAgent(task.agent_run_id)
      if (result.ok) {
        updateTask(task.id, { status: TASK_STATUS.CANCELLED })
        toast.success('Agent stopped')
      } else {
        toast.error(result.error ?? 'Failed to stop agent')
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

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      try {
        await window.api.sprint.delete(taskId)
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
        setSelectedTaskId(null)
        toast.success('Task deleted')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to delete task')
      }
    },
    []
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
  }, [selectedTaskId])

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

  useEffect(() => {
    runHealthCheck()
    const id = setInterval(runHealthCheck, POLL_HEALTH_CHECK_MS)
    return () => clearInterval(id)
  }, [runHealthCheck])

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

            <TaskTable
              section="done"
              tasks={partition.done}
              onPushToSprint={handlePushToSprint}
              onViewSpec={handleViewSpec}
              onViewOutput={handleViewOutput}
              onRerun={handleRerun}
            />

            {partition.failed.length > 0 && (
              <TaskTable
                section="failed"
                tasks={partition.failed}
                onPushToSprint={handlePushToSprint}
                onViewSpec={handleViewSpec}
                onViewOutput={handleViewOutput}
              />
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

            <TaskTable
              section="backlog"
              tasks={filteredBacklog}
              onPushToSprint={handlePushToSprint}
              onViewSpec={handleViewSpec}
              onViewOutput={handleViewOutput}
              onMarkDone={handleMarkDone}
              onUpdate={handleUpdatePriority}
            />
          </>
        )}
      </div>

      <PRSection />

      <SpecDrawer
        task={selectedTask}
        onClose={() => setSelectedTaskId(null)}
        onSave={handleSaveSpec}
        onLaunch={handleLaunch}
        onPushToSprint={handlePushToSprint}
        onMarkDone={handleMarkDone}
        onUpdate={handleUpdateTitle}
        onDelete={handleDeleteTask}
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
