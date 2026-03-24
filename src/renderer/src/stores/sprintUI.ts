import { create } from 'zustand'

interface SprintUIState {
  // --- State ---
  selectedTaskId: string | null
  logDrawerTaskId: string | null
  repoFilter: string | null
  generatingIds: string[]

  // --- Actions ---
  setSelectedTaskId: (id: string | null) => void
  setLogDrawerTaskId: (id: string | null) => void
  setRepoFilter: (filter: string | null) => void
  setGeneratingIds: (updater: (prev: string[]) => string[]) => void
}

export const useSprintUI = create<SprintUIState>((set) => ({
  selectedTaskId: null,
  logDrawerTaskId: null,
  repoFilter: null,
  generatingIds: [],

  setSelectedTaskId: (id): void => set({ selectedTaskId: id }),
  setLogDrawerTaskId: (id): void => set({ logDrawerTaskId: id }),
  setRepoFilter: (filter): void => set({ repoFilter: filter }),
  setGeneratingIds: (updater): void => {
    set((s) => ({ generatingIds: updater(s.generatingIds) }))
  },
}))
