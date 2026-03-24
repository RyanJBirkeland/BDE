import { create } from 'zustand'

interface SprintUIState {
  // --- State ---
  selectedTaskId: string | null
  logDrawerTaskId: string | null
  repoFilter: string | null
  generatingIds: string[]
  selectedTaskIds: string[]

  // --- Actions ---
  setSelectedTaskId: (id: string | null) => void
  setLogDrawerTaskId: (id: string | null) => void
  setRepoFilter: (filter: string | null) => void
  setGeneratingIds: (updater: (prev: string[]) => string[]) => void
  toggleTaskSelection: (id: string) => void
  selectRange: (fromId: string, toId: string, taskList: string[]) => void
  clearSelection: () => void
}

export const useSprintUI = create<SprintUIState>((set) => ({
  selectedTaskId: null,
  logDrawerTaskId: null,
  repoFilter: null,
  generatingIds: [],
  selectedTaskIds: [],

  setSelectedTaskId: (id): void => set({ selectedTaskId: id }),
  setLogDrawerTaskId: (id): void => set({ logDrawerTaskId: id }),
  setRepoFilter: (filter): void => set({ repoFilter: filter }),
  setGeneratingIds: (updater): void => {
    set((s) => ({ generatingIds: updater(s.generatingIds) }))
  },

  toggleTaskSelection: (id): void => {
    set((s) => {
      const isSelected = s.selectedTaskIds.includes(id)
      return {
        selectedTaskIds: isSelected
          ? s.selectedTaskIds.filter((taskId) => taskId !== id)
          : [...s.selectedTaskIds, id],
      }
    })
  },

  selectRange: (fromId, toId, taskList): void => {
    const fromIndex = taskList.indexOf(fromId)
    const toIndex = taskList.indexOf(toId)

    if (fromIndex === -1 || toIndex === -1) {
      set({ selectedTaskIds: [] })
      return
    }

    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)
    const selectedTaskIds = taskList.slice(start, end + 1)

    set({ selectedTaskIds })
  },

  clearSelection: (): void => {
    set({ selectedTaskIds: [] })
  },
}))
