import { create } from 'zustand'
import type { SprintTask, TaskDependency } from '../../../shared/types'
import { TASK_STATUS, PR_STATUS } from '../../../shared/constants'
import { toast } from './toasts'
import { sanitizeDependsOn } from '../../../shared/sanitize-depends-on'
import { isTaskStatus } from '../../../shared/task-state-machine'
import { WIP_LIMIT_IN_PROGRESS } from '../lib/constants'
import { canLaunchTask } from '../lib/wip-policy'
import { nowIso } from '../../../shared/time'
import {
  mergePendingFields,
  expirePendingUpdates,
  trackPendingOperation,
  type PendingUpdates,
  type SprintTaskField
} from '../lib/optimisticUpdateManager'
import { getRepoPaths } from '../services/git'
import { listTasks, updateTask, deleteTask, createTask, batchUpdate, generatePrompt, exportTaskHistory } from '../services/sprint'
import { spawnLocal } from '../services/agents'

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
export const PENDING_UPDATE_TTL = 5000

/**
 * Fields that can change during or after a task run. The poll-merge path
 * compares only these fields to decide whether to replace the store reference.
 * Fields outside this list (id, title, repo, spec, …) are treated as immutable
 * after creation; if one does change the task's `updated_at` timestamp will differ
 * and the fingerprint check above will force a full merge regardless.
 */
export const MUTABLE_TASK_FIELDS = [
  'status',
  'claimed_by',
  'completed_at',
  'failure_reason',
  'pr_status',
  'pr_url',
  'pr_number',
  'pr_mergeable_state',
  'retry_count',
  'fast_fail_count',
  'revision_feedback',
  'notes',
  'title',
  'spec',
  'worktree_path',
  'duration_ms',
  'promoted_to_review_at',
  'updated_at'
] as const satisfies ReadonlyArray<keyof SprintTask>

function withoutPendingUpdate(
  pendingUpdates: PendingUpdates,
  taskId: string,
  shouldClear: boolean
): PendingUpdates {
  if (!shouldClear) return pendingUpdates
  const { [taskId]: _, ...rest } = pendingUpdates
  return rest
}

function sanitizeIncomingTasks(raw: SprintTask[]): SprintTask[] {
  return (Array.isArray(raw) ? raw : []).map((t) => ({
    ...t,
    depends_on: sanitizeDependsOn(t.depends_on)
  }))
}

/**
 * Detects whether the task list has changed since the last poll.
 *
 * Builds a Map<id, updated_at> for each input and does a two-pass key/value
 * comparison — O(n) with no allocations beyond the two maps. This avoids
 * sorting a fresh array on every 30s background poll.
 */
function taskListsAreEqual(a: SprintTask[], b: SprintTask[]): boolean {
  if (a.length !== b.length) return false
  const aMap = new Map(a.map((t) => [t.id, t.updated_at]))
  for (const task of b) {
    if (aMap.get(task.id) !== task.updated_at) return false
  }
  return true
}

function hasNoPendingOps(state: {
  pendingUpdates: PendingUpdates
  pendingCreates: string[]
}): boolean {
  return Object.keys(state.pendingUpdates).length === 0 && state.pendingCreates.length === 0
}

function mergeTasksWithPendingState(
  incoming: SprintTask[],
  state: { tasks: SprintTask[]; pendingUpdates: PendingUpdates; pendingCreates: string[] },
  now: number
): { tasks: SprintTask[]; pendingUpdates: PendingUpdates } {
  const nextPending = expirePendingUpdates(state.pendingUpdates, PENDING_UPDATE_TTL)
  // Constructed here — not at poll entry — so it is only built when a merge is actually needed.
  const currentTaskMap = new Map(state.tasks.map((task) => [task.id, task]))

  const mergedById = new Map<string, SprintTask>()
  for (const task of incoming) {
    const merged = mergePendingFields(
      task,
      currentTaskMap.get(task.id),
      nextPending[task.id],
      now,
      PENDING_UPDATE_TTL
    )
    mergedById.set(task.id, stableTaskRef(merged, currentTaskMap.get(task.id)))
  }

  for (const tempId of state.pendingCreates) {
    if (!mergedById.has(tempId)) {
      const tempTask = currentTaskMap.get(tempId)
      if (tempTask) mergedById.set(tempId, tempTask)
    }
  }

  return {
    tasks: Array.from(mergedById.values()),
    pendingUpdates: nextPending
  }
}

export interface SprintTasksState {
  // --- Data ---
  tasks: SprintTask[]
  loading: boolean
  /**
   * True after the first successful `loadData()` completes. Use this to
   * distinguish "initial load still in flight" from "background refresh
   * in progress" — the latter should not show a full loading skeleton.
   *
   * TODO: Replace `loading`/`loadError`/`pollError` triple with a
   * discriminated union (`{ phase: 'idle' | 'loading' | 'error' }`) once
   * consuming components are refactored to use `hasLoadedOnce` consistently.
   */
  hasLoadedOnce: boolean
  loadError: string | null
  /** Non-null when the most recent `sprint:listTasks` IPC call failed. Cleared on success or manual dismiss. */
  pollError: string | null

  // --- Optimistic update protection ---
  pendingUpdates: PendingUpdates // taskId → {timestamp, field names}
  pendingCreates: string[] // temp IDs of optimistically created tasks

  // --- Actions ---
  loadData: () => Promise<void>
  clearPollError: () => void
  updateTask: (taskId: string, patch: Partial<SprintTask>) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  createTask: (data: CreateTicketInput) => Promise<string | null>
  generateSpec: (taskId: string, title: string, repo: string, templateHint: string) => Promise<void>
  launchTask: (task: SprintTask) => Promise<void>
  mergeSseUpdate: (update: { taskId: string; [key: string]: unknown }) => void
  setTasks: (tasks: SprintTask[]) => void
  batchDeleteTasks: (taskIds: string[]) => Promise<void>
  batchRequeueTasks: (taskIds: string[]) => Promise<void>
  exportTaskHistory: (taskId: string) => Promise<{ success: boolean; path?: string | undefined }>
}

export const selectActiveTaskCount = (state: SprintTasksState): number =>
  state.tasks.filter((t) => t.status === TASK_STATUS.ACTIVE).length

export const selectReviewTaskCount = (state: SprintTasksState): number =>
  state.tasks.reduce((n, t) => (t.status === 'review' ? n + 1 : n), 0)

export const selectFailedTaskCount = (state: SprintTasksState): number =>
  state.tasks.reduce((n, t) => (t.status === 'failed' || t.status === 'error' ? n + 1 : n), 0)

export const selectTasks = (state: SprintTasksState): SprintTask[] => state.tasks

/**
 * Returns `existing` when all mutable fields are identical to `incoming`, preserving the
 * object reference so downstream selectors and React components skip unnecessary re-renders.
 *
 * Only `MUTABLE_TASK_FIELDS` are compared — fields that never change after creation
 * (id, repo, created_at, …) are skipped entirely. If both references are already the
 * same object the check short-circuits immediately.
 */
function stableTaskRef(incoming: SprintTask, existing: SprintTask | undefined): SprintTask {
  if (existing === undefined) return incoming
  if (incoming === existing) return existing
  for (const field of MUTABLE_TASK_FIELDS) {
    if (!mutableFieldEqual(incoming[field], existing[field])) return incoming
  }
  return existing
}

function mutableFieldEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b)
  return false
}

/**
 * Merges only validated fields from an SSE update payload into an existing task.
 *
 * The SSE payload is typed as `{ taskId: string; [key: string]: unknown }`, so
 * any field could arrive with an unexpected type. This function validates each
 * field before applying it — invalid values are silently dropped so a malformed
 * SSE message cannot corrupt the task object in the store.
 *
 * Fields validated:
 * - `status`: must pass `isTaskStatus()` (9-value union)
 * - String/null fields: must be `typeof === 'string'` or `null`
 * - `depends_on`: routed through `sanitizeDependsOn` (handles any input)
 * - Numeric fields: must be `number` or `null`
 * - `playground_enabled`: must be `boolean`
 *
 * Complex fields like `revision_feedback` (array of objects) are intentionally
 * omitted — they are not part of normal SSE broadcast payloads.
 */
function applyValidatedSseFields(
  task: SprintTask,
  update: { taskId: string; [key: string]: unknown }
): SprintTask {
  const patch: Partial<SprintTask> = {}

  const raw = update as Record<string, unknown>

  if ('status' in raw) {
    const s = raw.status
    if (typeof s === 'string' && isTaskStatus(s)) patch.status = s
  }

  const stringOrNullFields: Array<keyof SprintTask> = [
    'claimed_by', 'completed_at', 'started_at', 'failure_reason',
    'pr_url', 'pr_status', 'pr_mergeable_state', 'notes', 'title',
    'spec', 'prompt', 'worktree_path',
    'promoted_to_review_at', 'updated_at', 'agent_run_id', 'template_name',
    'cross_repo_contract'
  ]
  for (const field of stringOrNullFields) {
    if (field in raw) {
      const v = raw[field]
      if (typeof v === 'string' || v === null) {
        ;(patch as Record<string, unknown>)[field] = v
      }
    }
  }

  const numberOrNullFields: Array<keyof SprintTask> = [
    'pr_number', 'retry_count', 'fast_fail_count', 'duration_ms', 'priority',
    'max_runtime_ms', 'max_cost_usd'
  ]
  for (const field of numberOrNullFields) {
    if (field in raw) {
      const v = raw[field]
      if (typeof v === 'number' || v === null) {
        ;(patch as Record<string, unknown>)[field] = v
      }
    }
  }

  if ('playground_enabled' in raw) {
    if (typeof raw.playground_enabled === 'boolean') {
      patch.playground_enabled = raw.playground_enabled
    }
  }

  return {
    ...task,
    ...patch,
    depends_on: sanitizeDependsOn(raw.depends_on ?? task.depends_on)
  }
}

export const useSprintTasks = create<SprintTasksState>((set, get) => ({
  tasks: [],
  loading: true,
  hasLoadedOnce: false,
  loadError: null,
  pollError: null,
  pendingUpdates: {},
  pendingCreates: [],

  clearPollError: (): void => set({ pollError: null }),

  loadData: async (): Promise<void> => {
    set({ loadError: null, pollError: null, loading: true })
    try {
      const incoming = sanitizeIncomingTasks(await listTasks())
      const currentState = get()

      if (taskListsAreEqual(currentState.tasks, incoming) && hasNoPendingOps(currentState)) {
        set({ loading: false, hasLoadedOnce: true })
        return
      }

      set((state) => ({ ...mergeTasksWithPendingState(incoming, state, Date.now()), hasLoadedOnce: true }))
    } catch (e) {
      const message = 'Failed to load tasks — ' + (e instanceof Error ? e.message : String(e))
      set({ loadError: message, pollError: message })
    } finally {
      set({ loading: false })
    }
  },

  updateTask: async (taskId, patch): Promise<void> => {
    const updateId = Date.now() // Unique ID for this update operation

    // Record pending update before optimistic patch, merging fields from prior pending updates.
    // `Object.keys(patch)` is typed as `string[]`; narrow it to the SprintTask field union so
    // `trackPendingOperation` type-checks. `patch: Partial<SprintTask>` guarantees every key is
    // a valid SprintTaskField at runtime.
    const patchedFields = Object.keys(patch) as SprintTaskField[]
    set((state) => ({
      pendingUpdates: trackPendingOperation(state.pendingUpdates, taskId, patchedFields, updateId),
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...patch, updated_at: nowIso() } : t))
    }))
    try {
      const serverTask = await updateTask(taskId, patch)
      // Apply server response (may differ from optimistic — e.g. auto-blocked) and clear pending
      // Only clear if this is still the most recent update for this task
      set((state) => {
        const current = state.pendingUpdates[taskId]
        const shouldClear = !current || current.ts === updateId

        return {
          pendingUpdates: withoutPendingUpdate(state.pendingUpdates, taskId, shouldClear),
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
          pendingUpdates: withoutPendingUpdate(state.pendingUpdates, taskId, shouldClear)
        }
      })
      toast.error(e instanceof Error ? e.message : 'Failed to update task')
      get().loadData() // revert optimistic on failure
    }
  },

  deleteTask: async (taskId): Promise<void> => {
    try {
      await deleteTask(taskId)
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== taskId),
        pendingUpdates: withoutPendingUpdate(state.pendingUpdates, taskId, true),
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
      stacked_on_task_id: null,
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
      const result = await createTask({
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
      })

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
      const genResult = await generatePrompt({
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
    const { updateTask } = get()
    // Block launch when WIP limit reached (unless task is already active)
    if (task.status !== TASK_STATUS.ACTIVE) {
      const activeCount = selectActiveTaskCount(get())
      if (!canLaunchTask(activeCount, WIP_LIMIT_IN_PROGRESS)) {
        toast.error(
          `In Progress is full (${WIP_LIMIT_IN_PROGRESS}/${WIP_LIMIT_IN_PROGRESS}) — finish or stop a task first`
        )
        return
      }
    }

    try {
      const repoPaths = await getRepoPaths()
      const repoPath = repoPaths[task.repo.toLowerCase()] ?? repoPaths[task.repo]
      if (!repoPath) {
        toast.error(`No repo path configured for "${task.repo}"`)
        return
      }

      const result = await spawnLocal({
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
        const merged = applyValidatedSseFields(t, update)
        if (merged.status === TASK_STATUS.DONE && merged.pr_url && !merged.pr_status) {
          merged.pr_status = PR_STATUS.OPEN
        }
        // Protect pending optimistic fields (same logic as loadData)
        const pending = state.pendingUpdates[t.id]
        if (pending && Date.now() - pending.ts <= PENDING_UPDATE_TTL) {
          for (const field of pending.fields) {
            // The generic K in the original preserveField kept this type-safe at the
            // function boundary. The cast through unknown is the minimal equivalent
            // that satisfies strict TypeScript when iterating a union-typed key.
            ;(merged as unknown as Record<string, unknown>)[field] =
              (t as unknown as Record<string, unknown>)[field]
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
      const result = await batchUpdate(operations)

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

  exportTaskHistory: async (taskId): Promise<{ success: boolean; path?: string | undefined }> => {
    return exportTaskHistory(taskId)
  },

  batchRequeueTasks: async (taskIds): Promise<void> => {
    if (taskIds.length === 0) return

    try {
      const operations = taskIds.map((id) => ({
        op: 'update' as const,
        id,
        patch: { status: TASK_STATUS.QUEUED }
      }))
      const result = await batchUpdate(operations)

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
