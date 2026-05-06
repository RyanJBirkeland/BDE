import { create } from 'zustand'
import type { TaskGroup, SprintTask, EpicDependency } from '../../../shared/types'
import { toast } from './toasts'
import { createTask, updateTask } from '../services/sprint'
import {
  listGroups,
  getGroupTasks,
  createGroup,
  updateGroup,
  deleteGroup,
  addTask,
  removeTask,
  queueAll,
  reorderTasks,
  addDependency,
  removeDependency,
  updateDependencyCondition
} from '../services/groups'

interface ImportPlanResult {
  epicId: string
  epicName: string
  taskCount: number
}

interface TaskGroupsState {
  groups: TaskGroup[]
  selectedGroupId: string | null
  groupTasks: SprintTask[]
  loading: boolean

  loadGroups: () => Promise<void>
  selectGroup: (id: string | null) => void
  importPlan: (repo: string) => Promise<ImportPlanResult>
  loadGroupTasks: (groupId: string) => Promise<void>
  createGroup: (input: {
    name: string
    icon?: string | undefined
    accent_color?: string | undefined
    goal?: string | undefined
  }) => Promise<TaskGroup | null>
  updateGroup: (
    id: string,
    patch: {
      name?: string | undefined
      icon?: string | undefined
      accent_color?: string | undefined
      goal?: string | undefined
      status?: 'draft' | 'ready' | 'in-pipeline' | 'completed' | undefined
      is_paused?: boolean | undefined
    }
  ) => Promise<void>
  togglePause: (id: string) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  addTaskToGroup: (taskId: string, groupId: string) => Promise<void>
  removeTaskFromGroup: (taskId: string) => Promise<void>
  queueAllTasks: (groupId: string) => Promise<number>
  reorderTasks: (groupId: string, orderedTaskIds: string[]) => Promise<void>
  addDependency: (groupId: string, dep: EpicDependency) => Promise<void>
  removeDependency: (groupId: string, upstreamId: string) => Promise<void>
  updateDependencyCondition: (
    groupId: string,
    upstreamId: string,
    condition: EpicDependency['condition']
  ) => Promise<void>
  createGroupFromTemplate: (
    template: {
      name: string
      icon: string
      accent_color?: string | undefined
      goal: string
      tasks: Array<{
        title: string
        spec: string
        spec_type: string
        priority?: number | undefined
      }>
    },
    repo: string
  ) => Promise<TaskGroup | null>
}

export const useTaskGroups = create<TaskGroupsState>((set, get) => ({
  groups: [],
  selectedGroupId: null,
  groupTasks: [],
  loading: false,

  loadGroups: async (): Promise<void> => {
    set({ loading: true })
    try {
      const result = await listGroups()
      set({ groups: Array.isArray(result) ? result : [] })
    } catch (e) {
      toast.error('Failed to load task groups — ' + (e instanceof Error ? e.message : String(e)))
      set({ groups: [] })
    } finally {
      set({ loading: false })
    }
  },

  selectGroup: (id: string | null): void => {
    set({ selectedGroupId: id })
    if (id) {
      get().loadGroupTasks(id)
    } else {
      set({ groupTasks: [] })
    }
  },

  loadGroupTasks: async (groupId: string): Promise<void> => {
    set({ loading: true })
    try {
      const tasks = await getGroupTasks(groupId)
      set({ groupTasks: Array.isArray(tasks) ? tasks : [] })
    } catch (e) {
      toast.error('Failed to load group tasks — ' + (e instanceof Error ? e.message : String(e)))
      set({ groupTasks: [] })
    } finally {
      set({ loading: false })
    }
  },

  createGroup: async (input): Promise<TaskGroup | null> => {
    try {
      const newGroup = await createGroup(input)
      set((s) => ({ groups: [...s.groups, newGroup] }))
      toast.success(`Group "${newGroup.name}" created`)
      return newGroup
    } catch (e) {
      toast.error('Failed to create group — ' + (e instanceof Error ? e.message : String(e)))
      return null
    }
  },

  updateGroup: async (id, patch): Promise<void> => {
    // Optimistic update — filter out undefined values so they don't overwrite required fields.
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined)
    ) as Partial<TaskGroup>
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, ...definedPatch } : g))
    }))
    try {
      const updated = await updateGroup(id, patch)
      set((s) => ({
        groups: s.groups.map((g) => (g.id === id ? updated : g))
      }))
      toast.success('Group updated')
    } catch (e) {
      toast.error('Failed to update group — ' + (e instanceof Error ? e.message : String(e)))
      // Revert optimistic update by reloading
      await get().loadGroups()
    }
  },

  togglePause: async (id): Promise<void> => {
    const group = get().groups.find((g) => g.id === id)
    if (!group) return
    const newPaused = !group.is_paused
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, is_paused: newPaused } : g))
    }))
    try {
      const updated = await updateGroup(id, { is_paused: newPaused })
      set((s) => ({ groups: s.groups.map((g) => (g.id === id ? updated : g)) }))
      toast.success(newPaused ? 'Epic paused — queued tasks will not be claimed' : 'Epic resumed')
    } catch (e) {
      toast.error('Failed to toggle pause — ' + (e instanceof Error ? e.message : String(e)))
      await get().loadGroups()
    }
  },

  deleteGroup: async (id): Promise<void> => {
    const groupToDelete = get().groups.find((g) => g.id === id)
    if (!groupToDelete) return

    // Optimistic delete
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      selectedGroupId: s.selectedGroupId === id ? null : s.selectedGroupId,
      groupTasks: s.selectedGroupId === id ? [] : s.groupTasks
    }))

    try {
      await deleteGroup(id)
      toast.success(`Group "${groupToDelete.name}" deleted`)
    } catch (e) {
      toast.error('Failed to delete group — ' + (e instanceof Error ? e.message : String(e)))
      // Revert optimistic delete by reloading
      await get().loadGroups()
    }
  },

  addTaskToGroup: async (taskId, groupId): Promise<void> => {
    try {
      const success = await addTask(taskId, groupId)
      if (success) {
        toast.success('Task added to group')
        // Reload group tasks if this group is selected
        if (get().selectedGroupId === groupId) {
          await get().loadGroupTasks(groupId)
        }
      } else {
        toast.error('Failed to add task to group')
      }
    } catch (e) {
      toast.error('Failed to add task to group — ' + (e instanceof Error ? e.message : String(e)))
    }
  },

  removeTaskFromGroup: async (taskId): Promise<void> => {
    try {
      const success = await removeTask(taskId)
      if (success) {
        toast.success('Task removed from group')
        // Reload current group tasks
        const selectedId = get().selectedGroupId
        if (selectedId) {
          await get().loadGroupTasks(selectedId)
        }
      } else {
        toast.error('Failed to remove task from group')
      }
    } catch (e) {
      toast.error(
        'Failed to remove task from group — ' + (e instanceof Error ? e.message : String(e))
      )
    }
  },

  queueAllTasks: async (groupId): Promise<number> => {
    try {
      const count = await queueAll(groupId)

      // Update group status to 'in-pipeline' after successful queuing
      if (count > 0) {
        await get().updateGroup(groupId, { status: 'in-pipeline' })
      }

      toast.success(`Queued ${count} task${count === 1 ? '' : 's'}`)

      // Reload group tasks to reflect new statuses
      if (get().selectedGroupId === groupId) {
        await get().loadGroupTasks(groupId)
      }

      return count
    } catch (e) {
      toast.error('Failed to queue tasks — ' + (e instanceof Error ? e.message : String(e)))
      return 0
    }
  },

  reorderTasks: async (groupId, orderedTaskIds): Promise<void> => {
    // Optimistic update
    const currentTasks = get().groupTasks
    const reorderedTasks = orderedTaskIds
      .map((id) => currentTasks.find((t) => t.id === id))
      .filter((t): t is SprintTask => t !== undefined)

    set({ groupTasks: reorderedTasks })

    try {
      await reorderTasks(groupId, orderedTaskIds)
    } catch (e) {
      toast.error('Failed to reorder tasks — ' + (e instanceof Error ? e.message : String(e)))
      // Revert by reloading
      await get().loadGroupTasks(groupId)
    }
  },

  addDependency: async (groupId, dep): Promise<void> => {
    try {
      const updated = await addDependency(groupId, dep)
      set((s) => ({
        groups: s.groups.map((g) => (g.id === groupId ? updated : g))
      }))
      toast.success('Dependency added')
    } catch (e) {
      toast.error('Failed to add dependency — ' + (e instanceof Error ? e.message : String(e)))
    }
  },

  removeDependency: async (groupId, upstreamId): Promise<void> => {
    try {
      const updated = await removeDependency(groupId, upstreamId)
      set((s) => ({
        groups: s.groups.map((g) => (g.id === groupId ? updated : g))
      }))
      toast.success('Dependency removed')
    } catch (e) {
      toast.error('Failed to remove dependency — ' + (e instanceof Error ? e.message : String(e)))
    }
  },

  updateDependencyCondition: async (groupId, upstreamId, condition): Promise<void> => {
    try {
      const updated = await updateDependencyCondition(groupId, upstreamId, condition)
      set((s) => ({
        groups: s.groups.map((g) => (g.id === groupId ? updated : g))
      }))
      toast.success('Dependency condition updated')
    } catch (e) {
      toast.error(
        'Failed to update dependency condition — ' + (e instanceof Error ? e.message : String(e))
      )
    }
  },

  importPlan: async (repo: string): Promise<ImportPlanResult> => {
    const result = await window.api.planner.import(repo)
    const imported = await listGroups()
    set({ groups: Array.isArray(imported) ? imported : [] })
    get().selectGroup(result.epicId)
    return result
  },

  createGroupFromTemplate: async (template, repo): Promise<TaskGroup | null> => {
    try {
      // Create the group
      const newGroup = await createGroup({
        name: template.name,
        icon: template.icon,
        accent_color: template.accent_color,
        goal: template.goal
      })
      set((s) => ({ groups: [...s.groups, newGroup] }))

      // Create tasks for the group
      for (const taskStub of template.tasks) {
        try {
          const task = await createTask({
            title: taskStub.title,
            repo,
            spec: taskStub.spec,
            priority: taskStub.priority ?? 0,
            status: 'backlog'
          })
          if (task) {
            // spec_type is an internal field outside SprintTaskPatch but accepted by UPDATE_ALLOWLIST at runtime.
            await updateTask(task.id, { spec_type: taskStub.spec_type } as Parameters<typeof window.api.sprint.update>[1])
            await addTask(task.id, newGroup.id)
          }
        } catch (taskError) {
          // Log error but continue creating other tasks
          console.error('Failed to create task:', taskError)
        }
      }

      toast.success(
        `Group "${newGroup.name}" created with ${template.tasks.length} task${template.tasks.length !== 1 ? 's' : ''}`
      )
      return newGroup
    } catch (e) {
      toast.error(
        'Failed to create group from template — ' + (e instanceof Error ? e.message : String(e))
      )
      return null
    }
  }
}))
