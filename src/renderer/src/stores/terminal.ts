import { create } from 'zustand'

export type TabKind = 'shell' | 'agent'

export interface TerminalTab {
  id: string
  title: string
  kind: TabKind
  shell?: string | undefined
  cwd?: string | undefined
  ptyId?: number | null | undefined
  agentId?: string | undefined
  agentSessionKey?: string | undefined
  isLabelCustom: boolean // user renamed this tab
  status: 'running' | 'exited'
  hasUnread: boolean // new output while tab not focused
}

let nextTabNum = 1

function makeTab(shell?: string, cwd?: string): TerminalTab {
  const num = nextTabNum++
  return {
    id: crypto.randomUUID(),
    title: `Terminal ${num}`,
    kind: 'shell',
    shell: shell || '/bin/zsh',
    cwd,
    ptyId: null,
    isLabelCustom: false,
    status: 'running',
    hasUnread: false
  }
}

function makeAgentTab(agentId: string, label: string, sessionKey?: string): TerminalTab {
  return {
    id: crypto.randomUUID(),
    title: label,
    kind: 'agent',
    agentId,
    agentSessionKey: sessionKey,
    isLabelCustom: false,
    status: 'running',
    hasUnread: false
  }
}

interface TerminalStore {
  tabs: TerminalTab[]
  activeTabId: string
  showFind: boolean
  splitEnabled: boolean
  splitTabId: string | null
  fontSize: number
  addTab: (shell?: string, cwd?: string) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  renameTab: (id: string, title: string) => void
  setPtyId: (tabId: string, ptyId: number) => void
  setShowFind: (show: boolean) => void
  toggleSplit: () => void
  openAgentTab: (agentId: string, label: string) => void
  createAgentTab: (agentId: string, label: string, sessionKey: string) => void
  reorderTab: (fromIdx: number, toIdx: number) => void
  setTabStatus: (id: string, status: 'running' | 'exited') => void
  setUnread: (id: string, hasUnread: boolean) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
}

const initialTab = makeTab()

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  showFind: false,
  splitEnabled: false,
  splitTabId: null,
  fontSize: 13,

  addTab: (shell?, cwd?) => {
    const tab = makeTab(shell, cwd)
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },

  closeTab: (id) => {
    const { tabs, activeTabId, splitTabId } = get()
    if (tabs.length <= 1) return
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    const newActiveTab = next[Math.min(idx, next.length - 1)]
    const newActive = activeTabId === id ? (newActiveTab?.id ?? activeTabId) : activeTabId
    // If closing the split tab, disable split
    const newSplitState = splitTabId === id ? { splitEnabled: false, splitTabId: null } : {}
    set({ tabs: next, activeTabId: newActive, ...newSplitState })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  renameTab: (id, title) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title, isLabelCustom: true } : t))
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
  },

  reorderTab: (fromIdx, toIdx) => {
    const { tabs } = get()
    const reordered = [...tabs]
    const [moved] = reordered.splice(fromIdx, 1)
    if (!moved) return
    reordered.splice(toIdx, 0, moved)
    set({ tabs: reordered })
  },

  setTabStatus: (id, status) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, status } : t))
    })),

  setUnread: (id, hasUnread) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, hasUnread } : t))
    })),

  zoomIn: () =>
    set((s) => ({
      fontSize: Math.min(s.fontSize + 1, 20)
    })),

  zoomOut: () =>
    set((s) => ({
      fontSize: Math.max(s.fontSize - 1, 10)
    })),

  resetZoom: () => set({ fontSize: 13 })
}))
