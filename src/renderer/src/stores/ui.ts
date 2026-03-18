import { create } from 'zustand'

export type View = 'sessions' | 'terminal' | 'sprint' | 'diff' | 'pr-station' | 'memory' | 'cost' | 'settings'

interface UIStore {
  activeView: View
  setView: (view: View) => void
}

export const useUIStore = create<UIStore>((set) => ({
  activeView: 'sessions',
  setView: (view) => set({ activeView: view })
}))
