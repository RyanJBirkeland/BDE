import { create } from 'zustand'

export interface TerminalTab {
  id: string
  label: string
  ptyId: number | null
}

let nextTabNum = 1

function makeTab(): TerminalTab {
  const num = nextTabNum++
  return { id: crypto.randomUUID(), label: `Terminal ${num}`, ptyId: null }
}

interface TerminalStore {
  tabs: TerminalTab[]
  activeTabId: string
  addTab: () => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  setPtyId: (tabId: string, ptyId: number) => void
}

const initialTab = makeTab()

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,

  addTab: () => {
    const tab = makeTab()
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get()
    if (tabs.length <= 1) return
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    const newActive =
      activeTabId === id ? next[Math.min(idx, next.length - 1)].id : activeTabId
    set({ tabs: next, activeTabId: newActive })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  setPtyId: (tabId, ptyId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ptyId } : t))
    }))
}))
