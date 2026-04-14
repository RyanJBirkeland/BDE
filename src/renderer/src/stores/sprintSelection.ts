import { create } from 'zustand'

interface SprintSelectionState {
  selectedTaskId: string | null
  selectedTaskIds: Set<string>
  logDrawerTaskId: string | null
  drawerOpen: boolean
  specPanelOpen: boolean

  setSelectedTaskId: (id: string | null) => void
  setLogDrawerTaskId: (id: string | null) => void
  setDrawerOpen: (open: boolean) => void
  setSpecPanelOpen: (open: boolean) => void
  clearTaskIfSelected: (taskId: string) => void
  clearSelection: () => void
  toggleTaskSelection: (id: string) => void
  clearMultiSelection: () => void
}

export const selectSelectedTaskId = (s: SprintSelectionState): string | null => s.selectedTaskId
export const selectSelectedTaskIds = (s: SprintSelectionState): Set<string> => s.selectedTaskIds
export const selectLogDrawerTaskId = (s: SprintSelectionState): string | null => s.logDrawerTaskId
export const selectDrawerOpen = (s: SprintSelectionState): boolean => s.drawerOpen
export const selectSpecPanelOpen = (s: SprintSelectionState): boolean => s.specPanelOpen

export const selectIsTaskSelected =
  (taskId: string) =>
  (s: SprintSelectionState): boolean =>
    s.selectedTaskIds.has(taskId)

export const useSprintSelection = create<SprintSelectionState>((set, get) => ({
  selectedTaskId: null,
  selectedTaskIds: new Set<string>(),
  logDrawerTaskId: null,
  drawerOpen: false,
  specPanelOpen: false,

  setSelectedTaskId: (id): void => {
    const current = get().selectedTaskId
    if (id === current) {
      set({ selectedTaskId: null, drawerOpen: false })
    } else {
      set({ selectedTaskId: id, drawerOpen: id !== null })
    }
  },
  setLogDrawerTaskId: (id): void => set({ logDrawerTaskId: id }),
  setDrawerOpen: (open): void => set({ drawerOpen: open }),
  setSpecPanelOpen: (open): void => set({ specPanelOpen: open }),
  clearTaskIfSelected: (taskId): void => {
    set((s) => (s.selectedTaskId === taskId ? { selectedTaskId: null, drawerOpen: false } : s))
  },
  clearSelection: (): void => {
    set({ selectedTaskIds: new Set<string>() })
  },
  toggleTaskSelection: (id): void => {
    set((s) => {
      const newSelection = new Set(s.selectedTaskIds)
      if (newSelection.has(id)) {
        newSelection.delete(id)
      } else {
        newSelection.add(id)
      }
      return { selectedTaskIds: newSelection }
    })
  },
  clearMultiSelection: (): void => {
    set({ selectedTaskIds: new Set<string>() })
  }
}))
