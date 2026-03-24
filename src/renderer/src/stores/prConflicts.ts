import { create } from 'zustand'

interface PrConflictsStore {
  /** Task IDs whose PRs have mergeable_state === 'dirty' */
  conflictingTaskIds: string[]
  /** Set the full list of conflicting task IDs (replaces previous) */
  setConflicts: (taskIds: string[]) => void
}

export const usePrConflictsStore = create<PrConflictsStore>((set) => ({
  conflictingTaskIds: [],
  setConflicts: (taskIds) =>
    set((state) => {
      // Avoid re-render if contents are identical
      if (
        state.conflictingTaskIds.length === taskIds.length &&
        taskIds.every((id) => state.conflictingTaskIds.includes(id))
      ) {
        return state
      }
      return { conflictingTaskIds: [...taskIds] }
    }),
}))
