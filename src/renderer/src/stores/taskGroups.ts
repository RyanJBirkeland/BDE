import { create } from 'zustand'
import type { TaskGroup, SprintTask } from '../../../shared/types'
import { toast } from './toasts'

interface TaskGroupsState {
  groups: TaskGroup[]
  selectedGroupId: string | null
  groupTasks: SprintTask[]
  loading: boolean

  loadGroups: () => Promise<void>
  selectGroup: (id: string | null) => void
  loadGroupTasks: (groupId: string) => Promise<void>
  createGroup: (input: {
    name: string
    icon?: string
    accent_color?: string
    goal?: string
  }) => Promise<TaskGroup | null>
  updateGroup: (
    id: string,
    patch: {
      name?: string
      icon?: string
      accent_color?: string
      goal?: string
      status?: 'draft' | 'ready' | 'in-pipeline' | 'completed'
    }
  ) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  addTaskToGroup: (taskId: string, groupId: string) => Promise<void>
  removeTaskFromGroup: (taskId: string) => Promise<void>
  queueAllTasks: (groupId: string) => Promise<number>
  reorderTasks: (groupId: string, orderedTaskIds: string[]) => Promise<void>
}

export const useTaskGroups = create<TaskGroupsState>((set, get) => ({
  groups: [],
  selectedGroupId: null,
  groupTasks: [],
  loading: false,

  loadGroups: async (): Promise<void> => {
    set({ loading: true })
    try {
      const result = await window.api.groups.list()
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
      const tasks = await window.api.groups.getGroupTasks(groupId)
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
      const newGroup = await window.api.groups.create(input)
      set((s) => ({ groups: [...s.groups, newGroup] }))
      toast.success(`Group "${newGroup.name}" created`)
      return newGroup
    } catch (e) {
      toast.error('Failed to create group — ' + (e instanceof Error ? e.message : String(e)))
      return null
    }
  },

  updateGroup: async (id, patch): Promise<void> => {
    // Optimistic update
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g))
    }))
    try {
      const updated = await window.api.groups.update(id, patch)
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
      await window.api.groups.delete(id)
      toast.success(`Group "${groupToDelete.name}" deleted`)
    } catch (e) {
      toast.error('Failed to delete group — ' + (e instanceof Error ? e.message : String(e)))
      // Revert optimistic delete by reloading
      await get().loadGroups()
    }
  },

  addTaskToGroup: async (taskId, groupId): Promise<void> => {
    try {
      const success = await window.api.groups.addTask(taskId, groupId)
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
      const success = await window.api.groups.removeTask(taskId)
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
      const count = await window.api.groups.queueAll(groupId)
      toast.success(`Queued ${count} task${count === 1 ? '' : 's'}`)
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
      await window.api.groups.reorderTasks(groupId, orderedTaskIds)
    } catch (e) {
      toast.error('Failed to reorder tasks — ' + (e instanceof Error ? e.message : String(e)))
      // Revert by reloading
      await get().loadGroupTasks(groupId)
    }
  }
}))
