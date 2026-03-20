import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type View = 'agents' | 'terminal' | 'sprint' | 'pr-station' | 'memory' | 'cost' | 'settings'
export type DropZone = 'top' | 'bottom' | 'left' | 'right' | 'center'

export interface PanelTab {
  viewKey: View
  label: string
}

export interface PanelLeafNode {
  type: 'leaf'
  panelId: string
  tabs: PanelTab[]
  activeTab: number
}

export interface PanelSplitNode {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  children: [PanelNode, PanelNode]
  sizes: [number, number]
}

export type PanelNode = PanelLeafNode | PanelSplitNode

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VIEW_LABELS: Record<View, string> = {
  agents: 'Agents',
  terminal: 'Terminal',
  sprint: 'Sprint',
  'pr-station': 'PR Station',
  memory: 'Memory',
  cost: 'Cost',
  settings: 'Settings',
}

// ---------------------------------------------------------------------------
// ID counter (deterministic for tests)
// ---------------------------------------------------------------------------

let idCounter = 0

export function _resetIdCounter(): void {
  idCounter = 0
}

function nextId(): string {
  idCounter += 1
  return `p${idCounter}`
}

// ---------------------------------------------------------------------------
// Pure mutation functions
// ---------------------------------------------------------------------------

export function createLeaf(viewKey: View): PanelLeafNode {
  return {
    type: 'leaf',
    panelId: nextId(),
    tabs: [{ viewKey, label: VIEW_LABELS[viewKey] }],
    activeTab: 0,
  }
}

export function findLeaf(node: PanelNode, panelId: string): PanelLeafNode | null {
  if (node.type === 'leaf') {
    return node.panelId === panelId ? node : null
  }
  return findLeaf(node.children[0], panelId) ?? findLeaf(node.children[1], panelId)
}

export function getOpenViews(node: PanelNode): View[] {
  if (node.type === 'leaf') {
    return node.tabs.map((t) => t.viewKey)
  }
  return [...getOpenViews(node.children[0]), ...getOpenViews(node.children[1])]
}

export function splitNode(
  root: PanelNode,
  targetId: string,
  direction: 'horizontal' | 'vertical',
  viewKey: View
): PanelNode | null {
  if (root.type === 'leaf') {
    if (root.panelId !== targetId) return null
    const newLeaf = createLeaf(viewKey)
    const split: PanelSplitNode = {
      type: 'split',
      direction,
      children: [root, newLeaf],
      sizes: [50, 50],
    }
    return split
  }

  const left = splitNode(root.children[0], targetId, direction, viewKey)
  if (left !== null) {
    return { ...root, children: [left, root.children[1]] }
  }

  const right = splitNode(root.children[1], targetId, direction, viewKey)
  if (right !== null) {
    return { ...root, children: [root.children[0], right] }
  }

  return null
}

export function addTab(root: PanelNode, targetId: string, viewKey: View): PanelNode | null {
  if (root.type === 'leaf') {
    if (root.panelId !== targetId) return null
    const newTab: PanelTab = { viewKey, label: VIEW_LABELS[viewKey] }
    const tabs = [...root.tabs, newTab]
    return { ...root, tabs, activeTab: tabs.length - 1 }
  }

  const left = addTab(root.children[0], targetId, viewKey)
  if (left !== null) {
    return { ...root, children: [left, root.children[1]] }
  }

  const right = addTab(root.children[1], targetId, viewKey)
  if (right !== null) {
    return { ...root, children: [root.children[0], right] }
  }

  return null
}

/**
 * Removes a tab from the target leaf.
 * Returns null when the last tab is removed (caller should remove the panel).
 */
export function closeTab(root: PanelNode, targetId: string, tabIndex: number): PanelNode | null {
  if (root.type === 'leaf') {
    if (root.panelId !== targetId) return null
    if (root.tabs.length === 1) return null // signal: remove leaf
    const tabs = root.tabs.filter((_, i) => i !== tabIndex)
    const activeTab = Math.min(root.activeTab - (tabIndex < root.activeTab ? 1 : 0), tabs.length - 1)
    return { ...root, tabs, activeTab }
  }

  const left = closeTab(root.children[0], targetId, tabIndex)
  // null means the leaf was found and should be removed — replace split with the other child
  if (left !== null || findLeaf(root.children[0], targetId) !== null) {
    if (left === null) return root.children[1] // collapse split
    return { ...root, children: [left, root.children[1]] }
  }

  const right = closeTab(root.children[1], targetId, tabIndex)
  if (right !== null || findLeaf(root.children[1], targetId) !== null) {
    if (right === null) return root.children[0] // collapse split
    return { ...root, children: [root.children[0], right] }
  }

  return null
}

export function setActiveTab(root: PanelNode, panelId: string, tabIndex: number): PanelNode | null {
  if (root.type === 'leaf') {
    if (root.panelId !== panelId) return null
    return { ...root, activeTab: tabIndex }
  }

  const left = setActiveTab(root.children[0], panelId, tabIndex)
  if (left !== null) {
    return { ...root, children: [left, root.children[1]] }
  }

  const right = setActiveTab(root.children[1], panelId, tabIndex)
  if (right !== null) {
    return { ...root, children: [root.children[0], right] }
  }

  return null
}

// ---------------------------------------------------------------------------
// Default layout
// ---------------------------------------------------------------------------

export const DEFAULT_LAYOUT: PanelNode = createLeaf('agents')

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

interface PanelLayoutState {
  root: PanelNode
  focusedPanelId: string | null

  splitPanel: (targetId: string, direction: 'horizontal' | 'vertical', viewKey: View) => void
  closeTab: (targetId: string, tabIndex: number) => void
  addTab: (targetId: string, viewKey: View) => void
  setActiveTab: (panelId: string, tabIndex: number) => void
  focusPanel: (panelId: string) => void
  resetLayout: () => void
  findPanelByView: (viewKey: View) => PanelLeafNode | null
  getOpenViews: () => View[]
}

export const usePanelLayoutStore = create<PanelLayoutState>((set, get) => ({
  root: DEFAULT_LAYOUT,
  focusedPanelId: (DEFAULT_LAYOUT as PanelLeafNode).panelId,

  splitPanel: (targetId, direction, viewKey): void => {
    set((s) => {
      const newRoot = splitNode(s.root, targetId, direction, viewKey)
      if (newRoot === null) return s
      return { root: newRoot }
    })
  },

  closeTab: (targetId, tabIndex): void => {
    set((s) => {
      const newRoot = closeTab(s.root, targetId, tabIndex)
      if (newRoot === null) return s // root itself was the only leaf — keep it
      return { root: newRoot }
    })
  },

  addTab: (targetId, viewKey): void => {
    set((s) => {
      const newRoot = addTab(s.root, targetId, viewKey)
      if (newRoot === null) return s
      return { root: newRoot }
    })
  },

  setActiveTab: (panelId, tabIndex): void => {
    set((s) => {
      const newRoot = setActiveTab(s.root, panelId, tabIndex)
      if (newRoot === null) return s
      return { root: newRoot }
    })
  },

  focusPanel: (panelId): void => {
    set({ focusedPanelId: panelId })
  },

  resetLayout: (): void => {
    const fresh = createLeaf('agents')
    set({ root: fresh, focusedPanelId: fresh.panelId })
  },

  findPanelByView: (viewKey): PanelLeafNode | null => {
    const { root } = get()
    const views = getOpenViews(root)
    if (!views.includes(viewKey)) return null
    // Walk tree to find first leaf containing the viewKey
    function search(node: PanelNode): PanelLeafNode | null {
      if (node.type === 'leaf') {
        return node.tabs.some((t) => t.viewKey === viewKey) ? node : null
      }
      return search(node.children[0]) ?? search(node.children[1])
    }
    return search(root)
  },

  getOpenViews: (): View[] => {
    return getOpenViews(get().root)
  },
}))
