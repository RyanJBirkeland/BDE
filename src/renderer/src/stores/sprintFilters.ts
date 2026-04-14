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

interface SprintFiltersState {
  statusFilter: StatusFilter
  repoFilter: string | null
  tagFilter: string | null
  searchQuery: string

  setStatusFilter: (filter: StatusFilter) => void
  setRepoFilter: (filter: string | null) => void
  setTagFilter: (filter: string | null) => void
  setSearchQuery: (query: string) => void
  clearAllFilters: () => void
}

export const useSprintFilters = create<SprintFiltersState>((set) => ({
  statusFilter: 'all',
  repoFilter: null,
  tagFilter: null,
  searchQuery: '',

  setStatusFilter: (filter): void => set({ statusFilter: filter }),
  setRepoFilter: (filter): void => set({ repoFilter: filter }),
  setTagFilter: (filter): void => set({ tagFilter: filter }),
  setSearchQuery: (query): void => set({ searchQuery: query }),
  clearAllFilters: (): void =>
    set({ statusFilter: 'all', repoFilter: null, tagFilter: null, searchQuery: '' })
}))
