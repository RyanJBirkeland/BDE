import { create } from 'zustand'
import type { SprintTask, TaskDependency } from '../../../shared/types'
import { TASK_STATUS, PR_STATUS } from '../../../shared/constants'
import { toast } from './toasts'
import { detectTemplate } from '../../../shared/template-heuristics'
import { WIP_LIMIT_IN_PROGRESS } from '../lib/constants'

export interface CreateTicketInput {
  title: string
  repo: string
  prompt?: string
  notes?: string
  spec?: string | null
  priority: number
  template_name?: string
  depends_on?: TaskDependency[]
  playground_enabled?: boolean
  spec_type?: string | null
}

/** Ensure depends_on is always a parsed array (Supabase JSONB may arrive as string). */
function sanitizeDeps(task: SprintTask): SprintTask {
  if (typeof task.depends_on === 'string') {
    try {
      task = { ...task, depends_on: JSON.parse(task.depends_on) }
    } catch {
      task = { ...task, depends_on: null }
    }
  }
  return task
}

/** How long (ms) to protect an optimistic update from being overwritten by poll data. */
const PENDING_UPDATE_TTL = 2000

interface SprintTasksState {
  // --- Data ---
  tasks: SprintTask[]
  loading: boolean
  loadError: string | null
  prMergedMap: Record<string, boolean>

  // --- Optimistic update protection ---
  pendingUpdates: Record<string, { ts: number; fields: string[] }> // taskId → {timestamp, field names}
  pendingCreates: string[] // temp IDs of optimistically created tasks

  // --- Actions ---
  loadData: () => Promise<void>
  updateTask: (taskId: string, patch: Partial<SprintTask>) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  createTask: (data: CreateTicketInput) => Promise<void>
  launchTask: (task: SprintTask) => Promise<void>
  mergeSseUpdate: (update: { taskId: string; [key: string]: unknown }) => void
  setPrMergedMap: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  setTasks: (tasks: SprintTask[]) => void
}

export const useSprintTasks = create<SprintTasksState>((set, get) => ({
  tasks: [],
  loading: true,
  loadError: null,
  prMergedMap: {},
  pendingUpdates: {},
  pendingCreates: [],

  loadData: async (): Promise<void> => {
    set({ loadError: null, loading: true })
    try {
      const result = (await window.api.sprint.list()) as SprintTask[]
      const incoming = (Array.isArray(result) ? result : []).map(sanitizeDeps)

      set((s) => {
        const now = Date.now()

        // Expire old pending updates (using a local Map for O(1) mutation)
        const nextPendingMap = new Map(Object.entries(s.pendingUpdates))
        for (const [id, pending] of nextPendingMap) {
          if (now - pending.ts > PENDING_UPDATE_TTL) nextPendingMap.delete(id)
        }
        const nextPending: Record<string, { ts: number; fields: string[] }> =
          Object.fromEntries(nextPendingMap)

        // Build a map of current optimistic tasks by ID for quick lookup
        const currentTaskMap = new Map(s.tasks.map((t) => [t.id, t]))

        // Merge incoming data, preserving only pending FIELDS from local version
        const mergedById = new Map<string, SprintTask>()
        for (const task of incoming) {
          const pending = nextPending[task.id]
          if (pending) {
            const localTask = currentTaskMap.get(task.id)
            if (localTask && now - pending.ts <= PENDING_UPDATE_TTL) {
              // Merge: start with server data, overlay only the pending fields from local
              const merged = { ...task } as unknown as Record<string, unknown>
              for (const field of pending.fields) {
                merged[field] = (localTask as unknown as Record<string, unknown>)[field]
              }
              mergedById.set(task.id, merged as unknown as SprintTask)
            } else {
              // TTL expired or local task missing — use server data
              mergedById.set(task.id, task)
            }
          } else {
            mergedById.set(task.id, task)
          }
        }

        // Preserve pending-create temp tasks that aren't in the DB yet
        for (const tempId of s.pendingCreates) {
          if (!mergedById.has(tempId)) {
            const tempTask = currentTaskMap.get(tempId)
            if (tempTask) mergedById.set(tempId, tempTask)
          }
        }

        return { tasks: Array.from(mergedById.values()), pendingUpdates: nextPending }
      })
    } catch (e) {
      set({ loadError: 'Failed to load tasks — ' + (e instanceof Error ? e.message : String(e)) })
    } finally {
      set({ loading: false })
    }
  },

  updateTask: async (taskId, patch): Promise<void> => {
    // Record pending update before optimistic patch, merging fields from prior pending updates
    set((s) => {
      const existing = s.pendingUpdates[taskId]
      const existingFields = existing?.fields ?? []
      const newFields = Object.keys(patch)
      const mergedFields = [...new Set([...existingFields, ...newFields])]

      return {
        pendingUpdates: {
          ...s.pendingUpdates,
          [taskId]: { ts: Date.now(), fields: mergedFields }
        },
        tasks: s.tasks.map((t) =>
          t.id === taskId ? { ...t, ...patch, updated_at: new Date().toISOString() } : t
        )
      }
    })
    try {
      await window.api.sprint.update(taskId, patch)
      // DB write committed — remove from pending
      set((s) => {
        const { [taskId]: _, ...rest } = s.pendingUpdates
        return { pendingUpdates: rest }
      })
    } catch (e) {
      // Remove from pending on failure too
      set((s) => {
        const { [taskId]: _, ...rest } = s.pendingUpdates
        return { pendingUpdates: rest }
      })
      toast.error(e instanceof Error ? e.message : 'Failed to update task')
      get().loadData() // revert optimistic on failure
    }
  },

  deleteTask: async (taskId): Promise<void> => {
    try {
      await window.api.sprint.delete(taskId)
      set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== taskId)
      }))
      // Notify UI store to deselect if this task was selected
      window.dispatchEvent(new CustomEvent('sprint:task-deleted', { detail: { taskId } }))
      toast.success('Task deleted')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete task')
    }
  },

  createTask: async (data): Promise<void> => {
    const repoEnum = data.repo.toLowerCase()
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
      claimed_by: null,
      started_at: null,
      completed_at: null,
      retry_count: 0,
      fast_fail_count: 0,
      template_name: data.template_name ?? null,
      depends_on: null,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    }
    set((s) => ({
      tasks: [optimistic, ...s.tasks],
      pendingCreates: [...s.pendingCreates, optimistic.id]
    }))

    try {
      const result = (await window.api.sprint.create({
        title: data.title,
        repo: repoEnum,
        prompt: data.prompt || data.title,
        notes: data.notes || undefined,
        spec: data.spec || undefined,
        priority: data.priority,
        status: TASK_STATUS.BACKLOG,
        template_name: data.template_name || undefined,
        playground_enabled: data.playground_enabled || undefined
      })) as SprintTask

      if (result?.id) {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === optimistic.id ? result : t)),
          pendingCreates: s.pendingCreates.filter((id) => id !== optimistic.id)
        }))

        // Background spec generation for Quick Mode tasks
        if (!data.spec) {
          const templateHint = detectTemplate(data.title)
          // Use a local Set to track generating state (no cross-store dependency)
          const generatingEvent = new CustomEvent('sprint:generating', {
            detail: { taskId: result.id, generating: true }
          })
          window.dispatchEvent(generatingEvent)

          window.api.sprint
            .generatePrompt({
              taskId: result.id,
              title: data.title,
              repo: repoEnum,
              templateHint
            })
            .then((genResult) => {
              set((s) => ({
                tasks: s.tasks.map((t) =>
                  t.id === genResult.taskId
                    ? { ...t, spec: genResult.spec || null, prompt: genResult.prompt }
                    : t
                )
              }))
              toast.info(`Spec ready for "${data.title}"`, {
                action: 'View Spec',
                onAction: () => {
                  const selectEvent = new CustomEvent('sprint:select-task', {
                    detail: { taskId: result.id }
                  })
                  window.dispatchEvent(selectEvent)
                },
                durationMs: 6000
              })
            })
            .catch((e: unknown) => {
              toast.error('Spec generation failed: ' + (e instanceof Error ? e.message : String(e)))
            })
            .finally(() => {
              const doneEvent = new CustomEvent('sprint:generating', {
                detail: { taskId: result.id, generating: false }
              })
              window.dispatchEvent(doneEvent)
            })
        }
      }
      toast.success('Ticket created — saved to Backlog')
    } catch (e) {
      set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== optimistic.id),
        pendingCreates: s.pendingCreates.filter((id) => id !== optimistic.id)
      }))
      toast.error(e instanceof Error ? e.message : 'Failed to create task')
    }
  },

  launchTask: async (task): Promise<void> => {
    const { tasks, updateTask } = get()
    // Block launch when WIP limit reached (unless task is already active)
    if (task.status !== TASK_STATUS.ACTIVE) {
      const activeCount = tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length
      if (activeCount >= WIP_LIMIT_IN_PROGRESS) {
        toast.error(
          `In Progress is full (${WIP_LIMIT_IN_PROGRESS}/${WIP_LIMIT_IN_PROGRESS}) — finish or stop a task first`
        )
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
        repoPath
      })

      await updateTask(task.id, {
        status: TASK_STATUS.ACTIVE,
        agent_run_id: result.id,
        started_at: new Date().toISOString()
      })
      toast.success('Agent launched')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to launch agent')
    }
  },

  mergeSseUpdate: (update): void => {
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== update.taskId) return t
        const merged = sanitizeDeps({ ...t, ...update } as SprintTask)
        if (merged.status === TASK_STATUS.DONE && merged.pr_url && !merged.pr_status) {
          merged.pr_status = PR_STATUS.OPEN
        }
        return merged
      })
    }))
  },

  setPrMergedMap: (updater): void => {
    set((s) => ({ prMergedMap: updater(s.prMergedMap) }))
  },

  setTasks: (tasks): void => set({ tasks: tasks.map(sanitizeDeps) })
}))
