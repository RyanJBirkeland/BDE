import { create } from 'zustand'

export type View = 'sessions' | 'sprint' | 'diff' | 'memory' | 'cost' | 'settings'
export type RepoFilter = 'all' | 'life-os' | 'feast'

interface UIStore {
  activeView: View
  repoFilter: RepoFilter
  setView: (view: View) => void
  setRepoFilter: (filter: RepoFilter) => void
}

export const useUIStore = create<UIStore>((set) => ({
  activeView: 'sessions',
  repoFilter: 'all',
  setView: (view) => set({ activeView: view }),
  setRepoFilter: (filter) => set({ repoFilter: filter })
}))
