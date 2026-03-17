import { create } from 'zustand'

interface PrConflictsStore {
  /** Task IDs whose PRs have mergeable_state === 'dirty' */
  conflictingTaskIds: Set<string>
  /** Set the full list of conflicting task IDs (replaces previous) */
  setConflicts: (taskIds: string[]) => void
}

export const usePrConflictsStore = create<PrConflictsStore>((set) => ({
  conflictingTaskIds: new Set(),
  setConflicts: (taskIds) =>
    set((state) => {
      // Avoid re-render if contents are identical
      if (
        state.conflictingTaskIds.size === taskIds.length &&
        taskIds.every((id) => state.conflictingTaskIds.has(id))
      ) {
        return state
      }
      return { conflictingTaskIds: new Set(taskIds) }
    }),
}))
