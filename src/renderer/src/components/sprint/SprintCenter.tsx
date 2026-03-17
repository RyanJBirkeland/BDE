import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { KanbanBoard } from './KanbanBoard'
import { TaskTable } from './TaskTable'
import { SpecDrawer } from './SpecDrawer'
import { LogDrawer } from './LogDrawer'
import { ConflictDrawer } from './ConflictDrawer'
import { PRSection } from './PRSection'
import { NewTicketModal } from './NewTicketModal'
import type { CreateTicketData } from './NewTicketModal'
import { toast } from '../../stores/toasts'
import { usePrConflictsStore } from '../../stores/prConflicts'
import { detectTemplate } from '../../../../shared/template-heuristics'
import { partitionSprintTasks } from '../../lib/partitionSprintTasks'
import { subscribeSSE, type TaskUpdatedEvent } from '../../lib/taskRunnerSSE'
import { setOpenLogDrawerTaskId } from '../../hooks/useTaskNotifications'
import {
  POLL_SPRINT_INTERVAL,
  POLL_SPRINT_ACTIVE_MS,
  POLL_PR_STATUS_MS,
  REPO_OPTIONS,
} from '../../lib/constants'

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
  const [selectedTask, setSelectedTask] = useState<SprintTask | null>(null)
  const [logDrawerTaskId, setLogDrawerTaskId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [prMergedMap, setPrMergedMap] = useState<Record<string, boolean>>({})
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set())
  const [conflictDrawerOpen, setConflictDrawerOpen] = useState(false)
  const logDrawerTask = logDrawerTaskId ? (tasks.find((t) => t.id === logDrawerTaskId) ?? null) : null

  // Keep notification hook aware of which task's LogDrawer is open
  useEffect(() => {
    setOpenLogDrawerTaskId(logDrawerTaskId)
    return () => setOpenLogDrawerTaskId(null)
  }, [logDrawerTaskId])

  const prevTasksRef = useRef<SprintTask[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const result = (await window.api.sprint.list()) as SprintTask[]
      const next = Array.isArray(result) ? result : []
      setTasks((prev) => {
        prevTasksRef.current = prev
        return next
      })
    } catch {
      // silent — data will be empty on first load if Supabase is unreachable
    } finally {
      setLoading(false)
    }
  }, [])

  // Adaptive sprint polling — consistency backstop (SSE handles real-time)
  const hasActiveTasks = tasks.some((t) => t.status === 'active')

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
          if (merged.status === 'done' && merged.pr_url && !merged.pr_status) {
            merged.pr_status = 'open'
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
        if (r.merged) updateTaskRef.current(r.taskId, { pr_status: 'merged' })
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
    pollPrStatuses(tasks)
    prIntervalRef.current = setInterval(() => pollPrStatuses(tasks), POLL_PR_STATUS_MS)
    return () => {
      if (prIntervalRef.current) clearInterval(prIntervalRef.current)
    }
  }, [tasks, pollPrStatuses])

  // Detect active→done transitions and trigger immediate PR poll
  useEffect(() => {
    const prev = prevTasksRef.current
    if (prev.length === 0) return
    const justDone = tasks.filter(
      (t) => t.status === 'done' && t.pr_url && prev.find((p) => p.id === t.id)?.status === 'active'
    )
    if (justDone.length > 0) pollPrStatuses(justDone)
  }, [tasks, pollPrStatuses])

  const updateTask = useCallback(
    async (taskId: string, patch: Partial<SprintTask>): Promise<void> => {
      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, ...patch, updated_at: new Date().toISOString() } : t
        )
      )
      setSelectedTask((prev) =>
        prev?.id === taskId ? { ...prev, ...patch, updated_at: new Date().toISOString() } : prev
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
        status: 'backlog',
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
          description: data.description || undefined,
          spec: data.spec || undefined,
          priority: data.priority,
          status: 'backlog',
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
      updateTask(task.id, { status: 'queued' })
      toast.success('Pushed to Sprint')
    },
    [updateTask]
  )

  const handleLaunch = useCallback(
    async (task: SprintTask) => {
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
          status: 'active',
          agent_run_id: result.id,
          started_at: new Date().toISOString(),
        })
        toast.success('Agent launched')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to launch agent')
      }
    },
    [updateTask]
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
      updateTask(task.id, { status: 'done', completed_at: new Date().toISOString() })
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
        updateTask(task.id, { status: 'cancelled' })
        toast.success('Agent stopped')
      } else {
        toast.error(result.error ?? 'Failed to stop agent')
      }
    },
    [updateTask]
  )

  const handleViewOutput = useCallback((task: SprintTask) => {
    setLogDrawerTaskId(task.id)
  }, [])

  // Keyboard shortcuts: N → new ticket, Escape → close drawers/modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedTask(null)
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
  }, [])

  const conflictingTaskIds = usePrConflictsStore((s) => s.conflictingTaskIds)
  const conflictingTasks = useMemo(
    () => tasks.filter((t) => conflictingTaskIds.has(t.id)),
    [tasks, conflictingTaskIds]
  )

  const filteredTasks = repoFilter
    ? tasks.filter((t) => t.repo.toLowerCase() === repoFilter.toLowerCase())
    : tasks

  const partition = useMemo(() => partitionSprintTasks(filteredTasks), [filteredTasks])

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
        {loading && tasks.length === 0 ? (
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
              onViewSpec={setSelectedTask}
              onViewOutput={handleViewOutput}
              onMarkDone={handleMarkDone}
              onStop={handleStop}
            />

            <TaskTable
              section="done"
              tasks={partition.done}
              onPushToSprint={handlePushToSprint}
              onViewSpec={setSelectedTask}
              onViewOutput={handleViewOutput}
            />

            <TaskTable
              section="backlog"
              tasks={partition.backlog}
              onPushToSprint={handlePushToSprint}
              onViewSpec={setSelectedTask}
              onViewOutput={handleViewOutput}
              onMarkDone={handleMarkDone}
            />
          </>
        )}
      </div>

      <PRSection />

      <SpecDrawer
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onSave={handleSaveSpec}
        onLaunch={handleLaunch}
        onPushToSprint={handlePushToSprint}
        onMarkDone={handleMarkDone}
      />

      <NewTicketModal open={modalOpen} onClose={() => setModalOpen(false)} onCreate={createTask} />

      <LogDrawer task={logDrawerTask} onClose={() => setLogDrawerTaskId(null)} onStop={handleStop} />

      <ConflictDrawer
        open={conflictDrawerOpen}
        tasks={conflictingTasks}
        onClose={() => setConflictDrawerOpen(false)}
      />
    </div>
  )
}
