import { create } from 'zustand'
import { useMemo } from 'react'
import { useSprintTasks } from './sprintTasks'
import type { SprintTask } from '../../../shared/types'

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

export function useVisibleStuckTasks(): {
  visibleStuckTasks: SprintTask[]
  dismissTask: (id: string) => void
} {
  const tasks = useSprintTasks((s) => s.tasks)
  const stuckTaskIds = useHealthCheckStore((s) => s.stuckTaskIds)
  const dismissedIds = useHealthCheckStore((s) => s.dismissedIds)
  const dismissTask = useHealthCheckStore((s) => s.dismiss)

  const visibleStuckTasks = useMemo(
    () => tasks.filter((t) => stuckTaskIds.includes(t.id) && !dismissedIds.includes(t.id)),
    [tasks, stuckTaskIds, dismissedIds]
  )

  return { visibleStuckTasks, dismissTask }
}
