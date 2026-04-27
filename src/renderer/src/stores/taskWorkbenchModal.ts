import { create } from 'zustand'
import type { SprintTask } from '../../../shared/types'
import { useTaskWorkbenchStore } from './taskWorkbench'

interface TaskWorkbenchModalState {
  open: boolean
  editingTask: SprintTask | null

  openForCreate: (preset?: { groupId?: string | null }) => void
  openForEdit: (task: SprintTask) => void
  close: () => void
}

export const useTaskWorkbenchModalStore = create<TaskWorkbenchModalState>((set) => ({
  open: false,
  editingTask: null,

  openForCreate: (preset) => {
    const form = useTaskWorkbenchStore.getState()
    form.resetForm()
    if (preset?.groupId) form.setField('pendingGroupId', preset.groupId)
    set({ open: true, editingTask: null })
  },

  openForEdit: (task) => {
    useTaskWorkbenchStore.getState().loadTask(task)
    set({ open: true, editingTask: task })
  },

  close: () => set({ open: false })
}))
