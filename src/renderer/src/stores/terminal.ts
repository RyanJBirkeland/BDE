import { create } from 'zustand'

export type TabKind = 'shell' | 'agent'

export interface TerminalTab {
  id: string
  title: string
  kind: TabKind
  shell?: string
  ptyId?: number | null
  agentId?: string
  agentSessionKey?: string
}

let nextTabNum = 1

function makeTab(shell?: string): TerminalTab {
  const num = nextTabNum++
  return {
    id: crypto.randomUUID(),
    title: `Terminal ${num}`,
    kind: 'shell',
    shell: shell || '/bin/zsh',
    ptyId: null
  }
}

function makeAgentTab(agentId: string, label: string, sessionKey?: string): TerminalTab {
  return {
    id: crypto.randomUUID(),
    title: label,
    kind: 'agent',
    agentId,
    agentSessionKey: sessionKey
  }
}

interface TerminalStore {
  tabs: TerminalTab[]
  activeTabId: string
  showFind: boolean
  splitEnabled: boolean
  splitTabId: string | null
  addTab: (shell?: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  renameTab: (id: string, title: string) => void
  setPtyId: (tabId: string, ptyId: number) => void
  setShowFind: (show: boolean) => void
  toggleSplit: () => void
  openAgentTab: (agentId: string, label: string) => void
  createAgentTab: (agentId: string, label: string, sessionKey: string) => void
}

const initialTab = makeTab()

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  showFind: false,
  splitEnabled: false,
  splitTabId: null,

  addTab: (shell?) => {
    const tab = makeTab(shell)
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },

  closeTab: (id) => {
    const { tabs, activeTabId, splitTabId } = get()
    if (tabs.length <= 1) return
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    const newActive =
      activeTabId === id ? next[Math.min(idx, next.length - 1)].id : activeTabId
    // If closing the split tab, disable split
    const newSplitState = splitTabId === id ? { splitEnabled: false, splitTabId: null } : {}
    set({ tabs: next, activeTabId: newActive, ...newSplitState })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  renameTab: (id, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t))
    })),

  setPtyId: (tabId, ptyId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ptyId } : t))
    })),

  setShowFind: (show) => set({ showFind: show }),

  toggleSplit: () => {
    const { splitEnabled, activeTabId } = get()
    set({
      splitEnabled: !splitEnabled,
      splitTabId: !splitEnabled ? activeTabId : null
    })
  },

  openAgentTab: (agentId, label) => {
    const tab = makeAgentTab(agentId, label)
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },

  createAgentTab: (agentId, label, sessionKey) => {
    const tab = makeAgentTab(agentId, label, sessionKey)
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  }
}))
