import { create } from 'zustand'

interface HealthCheckStore {
  stuckTaskIds: Set<string>
  dismissedIds: Set<string>
  setStuckTasks: (taskIds: string[]) => void
  dismiss: (taskId: string) => void
  clearDismissed: () => void
}

export const useHealthCheckStore = create<HealthCheckStore>((set) => ({
  stuckTaskIds: new Set(),
  dismissedIds: new Set(),
  setStuckTasks: (taskIds) =>
    set((state) => {
      if (
        state.stuckTaskIds.size === taskIds.length &&
        taskIds.every((id) => state.stuckTaskIds.has(id))
      ) {
        return state
      }
      return { stuckTaskIds: new Set(taskIds) }
    }),
  dismiss: (taskId) =>
    set((state) => {
      const next = new Set(state.dismissedIds)
      next.add(taskId)
      return { dismissedIds: next }
    }),
  clearDismissed: () => set({ dismissedIds: new Set() }),
}))
