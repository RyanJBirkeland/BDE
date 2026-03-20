import { create } from 'zustand'
import type { SprintTask } from '../../../shared/types'
import { TASK_STATUS, PR_STATUS } from '../../../shared/constants'
import { toast } from './toasts'
import { detectTemplate } from '../../../shared/template-heuristics'
import { WIP_LIMIT_IN_PROGRESS } from '../lib/constants'

export interface QueueHealth {
  queue: Record<string, number>
  doneToday: number
  connectedRunners: number
}

interface SprintState {
  // --- Data ---
  tasks: SprintTask[]
  loading: boolean
  loadError: string | null
  repoFilter: string | null
  selectedTaskId: string | null
  logDrawerTaskId: string | null
  prMergedMap: Record<string, boolean>
  generatingIds: Set<string>
  queueHealth: QueueHealth | null

  // --- Actions ---
  loadData: () => Promise<void>
  updateTask: (taskId: string, patch: Partial<SprintTask>) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  createTask: (data: CreateTicketInput) => Promise<void>
  launchTask: (task: SprintTask) => Promise<void>
  fetchQueueHealth: () => Promise<void>
  mergeSseUpdate: (update: { taskId: string; [key: string]: unknown }) => void
  setPrMergedMap: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  setGeneratingIds: (updater: (prev: Set<string>) => Set<string>) => void
  setRepoFilter: (filter: string | null) => void
  setSelectedTaskId: (id: string | null) => void
  setLogDrawerTaskId: (id: string | null) => void
  setTasks: (tasks: SprintTask[]) => void
}

export interface CreateTicketInput {
  title: string
  repo: string
  prompt?: string
  notes?: string
  spec?: string | null
  priority: number
  template_name?: string
}

export const useSprintStore = create<SprintState>((set, get) => ({
  tasks: [],
  loading: true,
  loadError: null,
  repoFilter: null,
  selectedTaskId: null,
  logDrawerTaskId: null,
  prMergedMap: {},
  generatingIds: new Set(),
  queueHealth: null,

  loadData: async (): Promise<void> => {
    set({ loadError: null, loading: true })
    try {
      const result = (await window.api.sprint.list()) as SprintTask[]
      set({ tasks: Array.isArray(result) ? result : [] })
    } catch (e) {
      set({ loadError: 'Failed to load tasks — ' + (e instanceof Error ? e.message : String(e)) })
    } finally {
      set({ loading: false })
    }
  },

  updateTask: async (taskId, patch): Promise<void> => {
    // Optimistic update
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, ...patch, updated_at: new Date().toISOString() } : t
      ),
    }))
    try {
      await window.api.sprint.update(taskId, patch)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update task')
      get().loadData() // revert optimistic on failure
    }
  },

  deleteTask: async (taskId): Promise<void> => {
    try {
      await window.api.sprint.delete(taskId)
      set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== taskId),
        selectedTaskId: s.selectedTaskId === taskId ? null : s.selectedTaskId,
      }))
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
      template_name: data.template_name ?? null,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
    set((s) => ({ tasks: [optimistic, ...s.tasks] }))

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
      })) as SprintTask

      if (result?.id) {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === optimistic.id ? result : t)),
        }))

        // Background spec generation for Quick Mode tasks
        if (!data.spec) {
          const templateHint = detectTemplate(data.title)
          set((s) => {
            if (s.generatingIds.has(result.id)) return s
            return { generatingIds: new Set(s.generatingIds).add(result.id) }
          })

          window.api.sprint
            .generatePrompt({
              taskId: result.id,
              title: data.title,
              repo: repoEnum,
              templateHint,
            })
            .then((genResult) => {
              set((s) => ({
                tasks: s.tasks.map((t) =>
                  t.id === genResult.taskId
                    ? { ...t, spec: genResult.spec || null, prompt: genResult.prompt }
                    : t
                ),
              }))
              toast.info(`Spec ready for "${data.title}"`, {
                action: 'View Spec',
                onAction: () => set({ selectedTaskId: result.id }),
                durationMs: 6000,
              })
            })
            .catch((e: unknown) => {
              toast.error('Spec generation failed: ' + (e instanceof Error ? e.message : String(e)))
            })
            .finally(() => {
              set((s) => {
                if (!s.generatingIds.has(result.id)) return s
                const next = new Set(s.generatingIds)
                next.delete(result.id)
                return { generatingIds: next }
              })
            })
        }
      }
      toast.success('Ticket created — saved to Backlog')
    } catch (e) {
      set((s) => ({ tasks: s.tasks.filter((t) => t.id !== optimistic.id) }))
      toast.error(e instanceof Error ? e.message : 'Failed to create task')
    }
  },

  launchTask: async (task): Promise<void> => {
    const { tasks, updateTask } = get()
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

      await updateTask(task.id, {
        status: TASK_STATUS.ACTIVE,
        agent_run_id: result.id,
        started_at: new Date().toISOString(),
      })
      toast.success('Agent launched')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to launch agent')
    }
  },

  fetchQueueHealth: async (): Promise<void> => {
    try {
      const health = await window.api.queue.health()
      set({ queueHealth: health })
    } catch {
      set({ queueHealth: null })
    }
  },

  mergeSseUpdate: (update): void => {
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== update.taskId) return t
        const merged = { ...t, ...update }
        if (merged.status === TASK_STATUS.DONE && merged.pr_url && !merged.pr_status) {
          merged.pr_status = PR_STATUS.OPEN
        }
        return merged
      }),
    }))
  },

  setPrMergedMap: (updater): void => {
    set((s) => ({ prMergedMap: updater(s.prMergedMap) }))
  },

  setGeneratingIds: (updater): void => {
    set((s) => ({ generatingIds: updater(s.generatingIds) }))
  },

  setRepoFilter: (filter): void => set({ repoFilter: filter }),
  setSelectedTaskId: (id): void => set({ selectedTaskId: id }),
  setLogDrawerTaskId: (id): void => set({ logDrawerTaskId: id }),
  setTasks: (tasks): void => set({ tasks }),
}))
