import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '../ui/Button'
import { KanbanBoard } from './KanbanBoard'
import { SpecDrawer } from './SpecDrawer'
import { PRSection } from './PRSection'
import { NewTicketModal } from './NewTicketModal'
import { toast } from '../../stores/toasts'
import { POLL_SPRINT_INTERVAL, REPO_OPTIONS } from '../../lib/constants'

// --- Types ---

export interface SprintTask {
  id: string
  title: string
  repo: string
  priority: number
  status: 'backlog' | 'queued' | 'active' | 'done'
  description: string | null
  spec: string | null
  agent_session_id: string | null
  pr_number: number | null
  pr_status: 'open' | 'merged' | 'closed' | 'draft' | null
  pr_url: string | null
  column_order: number
  started_at: string | null
  completed_at: string | null
  updated_at: string
  created_at: string
}

// --- Component ---

export default function SprintCenter() {
  const [tasks, setTasks] = useState<SprintTask[]>([])
  const [repoFilter, setRepoFilter] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<SprintTask | null>(null)
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async () => {
    try {
      const result = (await window.api.sprint.list()) as SprintTask[]
      setTasks(Array.isArray(result) ? result : [])
    } catch {
      // silent — data will be empty on first load if Supabase is unreachable
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    intervalRef.current = setInterval(loadData, POLL_SPRINT_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [loadData])

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
      try {
        const result = (await window.api.sprint.create({
          title: data.title,
          repo: data.repo,
          description: data.description || undefined,
          spec: data.spec || undefined,
          priority: data.priority,
          status: 'backlog',
        })) as SprintTask

        if (result?.id) {
          setTasks((prev) => [result, ...prev])
        }
        toast.success('Ticket created in Backlog')
      } catch (e) {
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
          agent_session_id: result.id,
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
    if (task.agent_session_id) {
      window.dispatchEvent(
        new CustomEvent('bde:navigate', {
          detail: { view: 'sessions', sessionId: task.agent_session_id },
        })
      )
    }
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
    </div>
  )
}
