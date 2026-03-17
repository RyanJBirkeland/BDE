import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Button } from '../ui/Button'
import { KanbanBoard } from './KanbanBoard'
import { SpecDrawer } from './SpecDrawer'
import { LogDrawer } from './LogDrawer'
import { PRSection } from './PRSection'
import { NewTicketModal } from './NewTicketModal'
import { toast } from '../../stores/toasts'
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
  const [logDrawerTask, setLogDrawerTask] = useState<SprintTask | null>(null)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [prMergedMap, setPrMergedMap] = useState<Record<string, boolean>>({})
  const prevTasksRef = useRef<SprintTask[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async () => {
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

  // SSE real-time task updates — surgical merge + debounced full reload
  const debouncedLoadRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedLoadData = useMemo(
    () => () => {
      if (debouncedLoadRef.current) clearTimeout(debouncedLoadRef.current)
      debouncedLoadRef.current = setTimeout(loadData, 300)
    },
    [loadData]
  )

  useEffect(() => {
    const handler = (event: { type: string; data: unknown }): void => {
      if (event.type === 'task:updated' && event.data && typeof event.data === 'object') {
        const patch = event.data as Partial<SprintTask> & { id?: string }
        if (patch.id) {
          setTasks((prev) => prev.map((t) => (t.id === patch.id ? { ...t, ...patch } : t)))
        }
      }
      debouncedLoadData()
    }
    window.api.onSprintSseEvent(handler)
    return () => {
      window.api.offSprintSseEvent()
      if (debouncedLoadRef.current) clearTimeout(debouncedLoadRef.current)
    }
  }, [debouncedLoadData])

  // PR status polling — check merged status for tasks with a pr_url
  const prMergedRef = useRef(prMergedMap)
  prMergedRef.current = prMergedMap

  const pollPrStatuses = useCallback(async (taskList: SprintTask[]) => {
    const withPr = taskList.filter((t) => t.pr_url && !prMergedRef.current[t.id])
    if (withPr.length === 0) return
    try {
      const results = await window.api.pollPrStatuses(
        withPr.map((t) => ({ taskId: t.id, prUrl: t.pr_url! }))
      )
      const merged: Record<string, boolean> = {}
      for (const r of results) merged[r.taskId] = r.merged
      setPrMergedMap((prev) => ({ ...prev, ...merged }))
    } catch {
      // gh CLI unavailable — degrade gracefully
    }
  }, [])

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
    async (taskId: string, patch: Partial<SprintTask>) => {
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

  const createTask = useCallback(
    async (data: { title: string; repo: string; description: string; spec: string; priority: number }) => {
      const repoEnum = REPO_LABEL_TO_ENUM[data.repo] ?? data.repo.toLowerCase()

      // Optimistic insert so the card appears immediately
      const optimistic: SprintTask = {
        id: `temp-${Date.now()}`,
        title: data.title,
        repo: repoEnum,
        priority: data.priority,
        status: 'backlog',
        description: data.description || null,
        spec: data.spec || null,
        prompt: data.spec || data.title,
        agent_run_id: null,
        pr_number: null,
        pr_status: null,
        pr_url: null,
        column_order: 0,
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
          prompt: data.spec || data.title,
          description: data.description || undefined,
          spec: data.spec || undefined,
          priority: data.priority,
          status: 'backlog',
        })) as SprintTask

        // Replace optimistic with server row
        if (result?.id) {
          setTasks((prev) => prev.map((t) => (t.id === optimistic.id ? result : t)))
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

  const handleViewOutput = useCallback((task: SprintTask) => {
    setLogDrawerTask(task)
  }, [])

  const filteredTasks = repoFilter
    ? tasks.filter((t) => t.repo.toLowerCase() === repoFilter.toLowerCase())
    : tasks

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
          <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>
            + New Ticket
          </Button>
          <Button variant="icon" size="sm" onClick={loadData} disabled={loading} title="Refresh">
            &#x21bb;
          </Button>
        </div>
      </div>

      {loading && tasks.length === 0 ? (
        <div className="sprint-board__loading" style={{ padding: 16 }}>
          <div className="sprint-board__skeleton" />
          <div className="sprint-board__skeleton" />
          <div className="sprint-board__skeleton" />
        </div>
      ) : (
        <KanbanBoard
          tasks={filteredTasks}
          prMergedMap={prMergedMap}
          onDragEnd={handleDragEnd}
          onPushToSprint={handlePushToSprint}
          onLaunch={handleLaunch}
          onViewSpec={setSelectedTask}
          onViewOutput={handleViewOutput}
        />
      )}

      <PRSection />

      <SpecDrawer
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onSave={handleSaveSpec}
        onLaunch={handleLaunch}
        onPushToSprint={handlePushToSprint}
      />

      <NewTicketModal open={modalOpen} onClose={() => setModalOpen(false)} onCreate={createTask} />

      <LogDrawer task={logDrawerTask} onClose={() => setLogDrawerTask(null)} />
    </div>
  )
}
