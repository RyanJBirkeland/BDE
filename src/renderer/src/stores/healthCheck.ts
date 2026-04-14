import { create } from 'zustand'

interface HealthCheckStore {
  stuckTaskIds: string[]
  dismissedIds: string[]
  setStuckTasks: (taskIds: string[]) => void
  dismiss: (taskId: string) => void
  clearDismissed: () => void
}

export const useHealthCheckStore = create<HealthCheckStore>((set) => ({
  stuckTaskIds: [],
  dismissedIds: [],
  setStuckTasks: (taskIds) =>
    set((state) => {
      if (
        state.stuckTaskIds.length === taskIds.length &&
        taskIds.every((id) => state.stuckTaskIds.includes(id))
      ) {
        return state
      }
      return { stuckTaskIds: [...taskIds] }
    }),
  dismiss: (taskId) =>
    set((state) => {
      if (state.dismissedIds.includes(taskId)) return state
      return { dismissedIds: [...state.dismissedIds, taskId] }
    }),
  clearDismissed: () => set({ dismissedIds: [] })
}))
