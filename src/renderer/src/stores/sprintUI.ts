import { create } from 'zustand'

export type StatusFilter =
  | 'all'
  | 'backlog'
  | 'todo'
  | 'blocked'
  | 'in-progress'
  | 'awaiting-review'
  | 'done'
  | 'failed'

interface SprintUIState {
  // --- State ---
  selectedTaskId: string | null
  logDrawerTaskId: string | null
  repoFilter: string | null
  tagFilter: string | null
  searchQuery: string
  statusFilter: StatusFilter
  generatingIds: string[]
  drawerOpen: boolean
  specPanelOpen: boolean
  doneViewOpen: boolean
  conflictDrawerOpen: boolean
  healthCheckDrawerOpen: boolean
  quickCreateOpen: boolean

  // --- Actions ---
  setSelectedTaskId: (id: string | null) => void
  setLogDrawerTaskId: (id: string | null) => void
  setDrawerOpen: (open: boolean) => void
  setSpecPanelOpen: (open: boolean) => void
  setDoneViewOpen: (open: boolean) => void
  setConflictDrawerOpen: (open: boolean) => void
  setHealthCheckDrawerOpen: (open: boolean) => void
  setQuickCreateOpen: (open: boolean) => void
  toggleQuickCreate: () => void
  setRepoFilter: (filter: string | null) => void
  setTagFilter: (filter: string | null) => void
  setSearchQuery: (query: string) => void
  setStatusFilter: (filter: StatusFilter) => void
  setGeneratingIds: (updater: (prev: string[]) => string[]) => void
  addGeneratingId: (id: string) => void
  removeGeneratingId: (id: string) => void
  clearTaskIfSelected: (taskId: string) => void
  clearSelection: () => void
}

export const useSprintUI = create<SprintUIState>((set, get) => ({
  selectedTaskId: null,
  logDrawerTaskId: null,
  repoFilter: null,
  tagFilter: null,
  searchQuery: '',
  statusFilter: 'all',
  generatingIds: [],
  drawerOpen: false,
  specPanelOpen: false,
  doneViewOpen: false,
  conflictDrawerOpen: false,
  healthCheckDrawerOpen: false,
  quickCreateOpen: false,

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
  setDoneViewOpen: (open): void => set({ doneViewOpen: open }),
  setConflictDrawerOpen: (open): void => set({ conflictDrawerOpen: open }),
  setHealthCheckDrawerOpen: (open): void => set({ healthCheckDrawerOpen: open }),
  setQuickCreateOpen: (open): void => set({ quickCreateOpen: open }),
  toggleQuickCreate: (): void => set((s) => ({ quickCreateOpen: !s.quickCreateOpen })),
  setRepoFilter: (filter): void => set({ repoFilter: filter }),
  setTagFilter: (filter): void => set({ tagFilter: filter }),
  setSearchQuery: (query): void => set({ searchQuery: query }),
  setStatusFilter: (filter): void => set({ statusFilter: filter }),
  setGeneratingIds: (updater): void => {
    set((s) => ({ generatingIds: updater(s.generatingIds) }))
  },
  addGeneratingId: (id): void => {
    set((s) => ({
      generatingIds: s.generatingIds.includes(id) ? s.generatingIds : [...s.generatingIds, id]
    }))
  },
  removeGeneratingId: (id): void => {
    set((s) => ({ generatingIds: s.generatingIds.filter((gid) => gid !== id) }))
  },
  clearTaskIfSelected: (taskId): void => {
    set((s) => (s.selectedTaskId === taskId ? { selectedTaskId: null, drawerOpen: false } : s))
  },

  clearSelection: (): void => {
    // No-op for now, kept for TaskPill compatibility
  }
}))
