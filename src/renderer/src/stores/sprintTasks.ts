import { create } from 'zustand'
import type { SprintTask, TaskDependency } from '../../../shared/types'
import { TASK_STATUS, PR_STATUS } from '../../../shared/constants'
import { toast } from './toasts'
import { sanitizeDependsOn } from '../../../shared/sanitize-depends-on'
import { WIP_LIMIT_IN_PROGRESS } from '../lib/constants'
import { canLaunchTask } from '../lib/wip-policy'
import { nowIso } from '../../../shared/time'

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
  max_cost_usd?: number | null
  model?: string
  spec_type?: string | null
  group_id?: string | null
  cross_repo_contract?: string | null
}

/** How long (ms) to protect an optimistic update from being overwritten by poll data. */
const PENDING_UPDATE_TTL = 2000

interface SprintTasksState {
  // --- Data ---
  tasks: SprintTask[]
  loading: boolean
  loadError: string | null

  // --- Optimistic update protection ---
  pendingUpdates: Record<string, { ts: number; fields: string[] }> // taskId → {timestamp, field names}
  pendingCreates: string[] // temp IDs of optimistically created tasks

  // --- Actions ---
  loadData: () => Promise<void>
  updateTask: (taskId: string, patch: Partial<SprintTask>) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  createTask: (data: CreateTicketInput) => Promise<string | null>
  generateSpec: (taskId: string, title: string, repo: string, templateHint: string) => Promise<void>
  launchTask: (task: SprintTask) => Promise<void>
  mergeSseUpdate: (update: { taskId: string; [key: string]: unknown }) => void
  setTasks: (tasks: SprintTask[]) => void
  batchDeleteTasks: (taskIds: string[]) => Promise<void>
  batchRequeueTasks: (taskIds: string[]) => Promise<void>
}

export const selectActiveTaskCount = (state: SprintTasksState): number =>
  state.tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length

export const useSprintTasks = create<SprintTasksState>((set, get) => ({
  tasks: [],
  loading: true,
  loadError: null,
  pendingUpdates: {},
  pendingCreates: [],

  loadData: async (): Promise<void> => {
    set({ loadError: null, loading: true })
    try {
      const result = (await window.api.sprint.list()) as SprintTask[]
      const incoming = (Array.isArray(result) ? result : []).map((t) => ({
        ...t,
        depends_on: sanitizeDependsOn(t.depends_on)
      }))

      const currentState = get()

      // Build fingerprints to detect if tasks have changed
      const currentFingerprint = currentState.tasks
        .map((task) => `${task.id}:${task.updated_at}`)
        .sort()
        .join('|')
      const incomingFingerprint = incoming
        .map((task) => `${task.id}:${task.updated_at}`)
        .sort()
        .join('|')

      // Skip set() if tasks haven't changed and there are no pending operations
      const hasPendingOps =
        Object.keys(currentState.pendingUpdates).length > 0 ||
        currentState.pendingCreates.length > 0

      if (currentFingerprint === incomingFingerprint && !hasPendingOps) {
        set({ loading: false })
        return
      }

      set((state) => {
        const now = Date.now()

        // Expire old pending updates (using a local Map for O(1) mutation)
        const nextPendingMap = new Map(Object.entries(state.pendingUpdates))
        for (const [id, pending] of nextPendingMap) {
          if (now - pending.ts > PENDING_UPDATE_TTL) nextPendingMap.delete(id)
        }
        const nextPending: Record<string, { ts: number; fields: string[] }> =
          Object.fromEntries(nextPendingMap)

        // Build a map of current optimistic tasks by ID for quick lookup
        const currentTaskMap = new Map(state.tasks.map((task) => [task.id, task]))

        // Merge incoming data, preserving only pending FIELDS from local version
        const mergedById = new Map<string, SprintTask>()
        for (const task of incoming) {
          const pending = nextPending[task.id]
          if (pending) {
            const localTask = currentTaskMap.get(task.id)
            if (localTask && now - pending.ts <= PENDING_UPDATE_TTL) {
              // Merge: start with server data, overlay only the pending fields from local
              const merged = { ...task } as unknown as Record<string, unknown>
              for (const fieldName of pending.fields) {
                merged[fieldName] = (localTask as unknown as Record<string, unknown>)[fieldName]
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
        for (const tempId of state.pendingCreates) {
          if (!mergedById.has(tempId)) {
            const tempTask = currentTaskMap.get(tempId)
            if (tempTask) mergedById.set(tempId, tempTask)
          }
        }

        const nextTasks = Array.from(mergedById.values())
        return {
          tasks: nextTasks,
          pendingUpdates: nextPending
        }
      })
    } catch (e) {
      set({ loadError: 'Failed to load tasks — ' + (e instanceof Error ? e.message : String(e)) })
    } finally {
      set({ loading: false })
    }
  },

  updateTask: async (taskId, patch): Promise<void> => {
    const updateId = Date.now() // Unique ID for this update operation

    // Record pending update before optimistic patch, merging fields from prior pending updates
    set((state) => {
      const existing = state.pendingUpdates[taskId]
      const existingFields = existing?.fields ?? []
      const newFields = Object.keys(patch)
      const mergedFields = [...new Set([...existingFields, ...newFields])]

      return {
        pendingUpdates: {
          ...state.pendingUpdates,
          [taskId]: { ts: updateId, fields: mergedFields }
        },
        tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...patch, updated_at: nowIso() } : t))
      }
    })
    try {
      const serverTask = (await window.api.sprint.update(taskId, patch)) as SprintTask | null
      // Apply server response (may differ from optimistic — e.g. auto-blocked) and clear pending
      // Only clear if this is still the most recent update for this task
      set((state) => {
        const current = state.pendingUpdates[taskId]
        const shouldClear = !current || current.ts === updateId

        return {
          pendingUpdates: shouldClear
            ? (() => {
                const { [taskId]: _, ...rest } = state.pendingUpdates
                return rest
              })()
            : state.pendingUpdates,
          tasks: serverTask?.id
            ? state.tasks.map((t) =>
                t.id === taskId
                  ? { ...serverTask, depends_on: sanitizeDependsOn(serverTask.depends_on) }
                  : t
              )
            : state.tasks
        }
      })
    } catch (e) {
      // Remove from pending on failure only if this is still the most recent update
      set((state) => {
        const current = state.pendingUpdates[taskId]
        const shouldClear = !current || current.ts === updateId

        return {
          pendingUpdates: shouldClear
            ? (() => {
                const { [taskId]: _, ...rest } = state.pendingUpdates
                return rest
              })()
            : state.pendingUpdates
        }
      })
      toast.error(e instanceof Error ? e.message : 'Failed to update task')
      get().loadData() // revert optimistic on failure
    }
  },

  deleteTask: async (taskId): Promise<void> => {
    try {
      await window.api.sprint.delete(taskId)
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== taskId),
        pendingUpdates: Object.fromEntries(
          Object.entries(state.pendingUpdates).filter(([id]) => id !== taskId)
        ),
        pendingCreates: state.pendingCreates.filter((id) => id !== taskId)
      }))
      toast.success('Task deleted')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete task')
    }
  },

  createTask: async (data: CreateTicketInput): Promise<string | null> => {
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
      depends_on: data.depends_on ?? null,
      updated_at: nowIso(),
      created_at: nowIso()
    }
    set((state) => ({
      tasks: [optimistic, ...state.tasks],
      pendingCreates: [...state.pendingCreates, optimistic.id]
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
        playground_enabled: data.playground_enabled || undefined,
        ...(data.depends_on ? { depends_on: data.depends_on } : {}),
        ...(data.group_id ? { group_id: data.group_id } : {})
      } as Parameters<typeof window.api.sprint.create>[0])) as SprintTask

      if (result?.id) {
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === optimistic.id ? result : t)),
          pendingCreates: state.pendingCreates.filter((id) => id !== optimistic.id)
        }))

        toast.success('Ticket created — saved to Backlog')
        return result.id
      }
      toast.success('Ticket created — saved to Backlog')
      return null
    } catch (e) {
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== optimistic.id),
        pendingCreates: state.pendingCreates.filter((id) => id !== optimistic.id)
      }))
      toast.error(e instanceof Error ? e.message : 'Failed to create task')
      return null
    }
  },

  generateSpec: async (taskId, title, repo, templateHint): Promise<void> => {
    try {
      const genResult = await window.api.sprint.generatePrompt({
        taskId,
        title,
        repo,
        templateHint
      })
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === genResult.taskId
            ? { ...t, spec: genResult.spec || null, prompt: genResult.prompt }
            : t
        )
      }))
    } catch (e) {
      toast.error('Spec generation failed: ' + (e instanceof Error ? e.message : String(e)))
    }
  },

  launchTask: async (task): Promise<void> => {
    const { tasks, updateTask } = get()
    // Block launch when WIP limit reached (unless task is already active)
    if (task.status !== TASK_STATUS.ACTIVE) {
      const activeCount = tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length
      if (!canLaunchTask(activeCount, WIP_LIMIT_IN_PROGRESS)) {
        toast.error(
          `In Progress is full (${WIP_LIMIT_IN_PROGRESS}/${WIP_LIMIT_IN_PROGRESS}) — finish or stop a task first`
        )
        return
      }
    }

    try {
      const repoPaths = await window.api.git.getRepoPaths()
      const repoPath = repoPaths[task.repo.toLowerCase()] ?? repoPaths[task.repo]
      if (!repoPath) {
        toast.error(`No repo path configured for "${task.repo}"`)
        return
      }

      const result = await window.api.agents.spawnLocal({
        task: task.spec ?? task.title,
        repoPath
      })

      await updateTask(task.id, {
        status: TASK_STATUS.ACTIVE,
        agent_run_id: result.id,
        started_at: nowIso()
      })
      toast.success('Agent launched')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to launch agent')
    }
  },

  mergeSseUpdate: (update): void => {
    set((state) => {
      const nextTasks = state.tasks.map((t) => {
        if (t.id !== update.taskId) return t
        const merged = {
          ...t,
          ...update,
          depends_on: sanitizeDependsOn(
            (update as Record<string, unknown>).depends_on ?? t.depends_on
          )
        } as SprintTask
        if (merged.status === TASK_STATUS.DONE && merged.pr_url && !merged.pr_status) {
          merged.pr_status = PR_STATUS.OPEN
        }
        // Protect pending optimistic fields (same logic as loadData)
        const pending = state.pendingUpdates[t.id]
        if (pending && Date.now() - pending.ts <= PENDING_UPDATE_TTL) {
          for (const field of pending.fields) {
            ;(merged as unknown as Record<string, unknown>)[field] = (
              t as unknown as Record<string, unknown>
            )[field]
          }
        }
        return merged
      })
      return { tasks: nextTasks }
    })
  },

  setTasks: (tasks): void =>
    set({ tasks: tasks.map((t) => ({ ...t, depends_on: sanitizeDependsOn(t.depends_on) })) }),

  batchDeleteTasks: async (taskIds): Promise<void> => {
    if (taskIds.length === 0) return

    try {
      const operations = taskIds.map((id) => ({ op: 'delete' as const, id }))
      const result = await window.api.sprint.batchUpdate(operations)

      // Check for any errors
      const errors = result.results.filter((r) => !r.ok)
      if (errors.length > 0) {
        toast.error(`Failed to delete ${errors.length} task(s)`)
      } else {
        toast.success(`Deleted ${taskIds.length} task(s)`)
      }

      // Remove successfully deleted tasks from state
      const deletedIds = new Set(result.results.filter((r) => r.ok).map((r) => r.id))
      set((state) => ({
        tasks: state.tasks.filter((t) => !deletedIds.has(t.id)),
        pendingUpdates: Object.fromEntries(
          Object.entries(state.pendingUpdates).filter(([id]) => !deletedIds.has(id))
        ),
        pendingCreates: state.pendingCreates.filter((id) => !deletedIds.has(id))
      }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete tasks')
    }
  },

  batchRequeueTasks: async (taskIds): Promise<void> => {
    if (taskIds.length === 0) return

    try {
      const operations = taskIds.map((id) => ({
        op: 'update' as const,
        id,
        patch: { status: TASK_STATUS.QUEUED }
      }))
      const result = await window.api.sprint.batchUpdate(operations)

      // Check for any errors
      const errors = result.results.filter((r) => !r.ok)
      if (errors.length > 0) {
        const errorMessages = errors.map((e) => e.error).filter(Boolean)
        toast.error(
          `Failed to requeue ${errors.length} task(s)${errorMessages.length > 0 ? `: ${errorMessages[0]}` : ''}`
        )
      } else {
        toast.success(`Requeued ${taskIds.length} task(s)`)
      }

      // Reload data to get updated task states (including dependency blocking)
      await get().loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to requeue tasks')
    }
  }
}))
