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

/**
 * Moves a tab from one panel to another, splitting if needed.
 * Returns null if either panel is not found or the tab index is invalid.
 */
export function moveTab(
  root: PanelNode,
  sourcePanelId: string,
  sourceTabIndex: number,
  targetPanelId: string,
  zone: DropZone
): PanelNode | null {
  const sourceLeaf = findLeaf(root, sourcePanelId)
  if (!sourceLeaf) return null
  if (sourceTabIndex < 0 || sourceTabIndex >= sourceLeaf.tabs.length) return null

  const movedTab = sourceLeaf.tabs[sourceTabIndex]

  // Remove tab from source; if last tab, the leaf will be removed from the tree
  const afterClose = closeTab(root, sourcePanelId, sourceTabIndex)
  // afterClose is null only when root itself was the only leaf with one tab
  const treeAfterClose = afterClose ?? root

  if (zone === 'center') {
    const result = addTab(treeAfterClose, targetPanelId, movedTab.viewKey)
    return result ?? treeAfterClose
  }

  // Edge zones: split the target panel
  const direction: 'horizontal' | 'vertical' =
    zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical'

  // For 'left' and 'top', the new panel should be the first child.
  // For 'right' and 'bottom', the new panel should be the second child (default splitNode behaviour).
  if (zone === 'left' || zone === 'top') {
    // We need to inject as first child — do a manual split
    const targetLeaf = findLeaf(treeAfterClose, targetPanelId)
    if (!targetLeaf) {
      // Target was removed (source == target, only tab); fall back to addTab on any remaining leaf
      return treeAfterClose
    }
    const newLeaf = createLeaf(movedTab.viewKey)
    const splitResult = replacLeafWithSplit(treeAfterClose, targetPanelId, direction, newLeaf, 'first')
    return splitResult ?? treeAfterClose
  }

  // 'right' or 'bottom': new panel is second child (default)
  const targetLeaf = findLeaf(treeAfterClose, targetPanelId)
  if (!targetLeaf) return treeAfterClose
  const newLeaf = createLeaf(movedTab.viewKey)
  const splitResult = replacLeafWithSplit(treeAfterClose, targetPanelId, direction, newLeaf, 'second')
  return splitResult ?? treeAfterClose
}

/**
 * Replaces the leaf at targetId with a split containing [newLeaf, targetLeaf]
 * or [targetLeaf, newLeaf] depending on `newPosition`.
 */
function replacLeafWithSplit(
  root: PanelNode,
  targetId: string,
  direction: 'horizontal' | 'vertical',
  newLeaf: PanelLeafNode,
  newPosition: 'first' | 'second'
): PanelNode | null {
  if (root.type === 'leaf') {
    if (root.panelId !== targetId) return null
    const children: [PanelNode, PanelNode] =
      newPosition === 'first' ? [newLeaf, root] : [root, newLeaf]
    const split: PanelSplitNode = {
      type: 'split',
      direction,
      children,
      sizes: [50, 50],
    }
    return split
  }

  const left = replacLeafWithSplit(root.children[0], targetId, direction, newLeaf, newPosition)
  if (left !== null) {
    return { ...root, children: [left, root.children[1]] }
  }

  const right = replacLeafWithSplit(root.children[1], targetId, direction, newLeaf, newPosition)
  if (right !== null) {
    return { ...root, children: [root.children[0], right] }
  }

  return null
}

// ---------------------------------------------------------------------------
// Layout validation helpers
// ---------------------------------------------------------------------------

function isValidLayout(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const n = node as Record<string, unknown>
  if (n.type === 'leaf') return Array.isArray(n.tabs) && (n.tabs as unknown[]).length > 0
  if (n.type === 'split')
    return (
      Array.isArray(n.children) &&
      (n.children as unknown[]).length === 2 &&
      isValidLayout((n.children as unknown[])[0]) &&
      isValidLayout((n.children as unknown[])[1])
    )
  return false
}

function findFirstLeaf(node: PanelNode): PanelLeafNode | null {
  if (node.type === 'leaf') return node
  return findFirstLeaf(node.children[0])
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
  moveTab: (sourcePanelId: string, sourceTabIndex: number, targetPanelId: string, zone: DropZone) => void
  focusPanel: (panelId: string) => void
  resetLayout: () => void
  loadSavedLayout: () => Promise<void>
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

  moveTab: (sourcePanelId, sourceTabIndex, targetPanelId, zone): void => {
    set((s) => {
      const newRoot = moveTab(s.root, sourcePanelId, sourceTabIndex, targetPanelId, zone)
      if (newRoot === null) return s
      return { root: newRoot }
    })
  },

  focusPanel: (panelId): void => {
    set({ focusedPanelId: panelId })
  },

  resetLayout: (): void => {
    _resetIdCounter()
    const fresh = createLeaf('agents')
    set({ root: fresh, focusedPanelId: fresh.panelId })
    if (typeof window !== 'undefined' && window.api?.settings) {
      window.api.settings.setJson('panel.layout', null).catch(() => {})
    }
  },

  loadSavedLayout: async (): Promise<void> => {
    try {
      if (typeof window === 'undefined' || !window.api?.settings) return
      const saved = await window.api.settings.getJson('panel.layout')
      if (saved && isValidLayout(saved)) {
        const root = saved as PanelNode
        const firstLeaf = findFirstLeaf(root)
        set({ root, focusedPanelId: firstLeaf?.panelId ?? '' })
      }
    } catch {
      /* use default */
    }
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

// ---------------------------------------------------------------------------
// Persist layout on every mutation (debounced)
// ---------------------------------------------------------------------------

let _saveTimeout: ReturnType<typeof setTimeout> | null = null

usePanelLayoutStore.subscribe((state) => {
  if (typeof window === 'undefined' || !window.api?.settings) return
  if (_saveTimeout) clearTimeout(_saveTimeout)
  _saveTimeout = setTimeout(() => {
    window.api.settings.setJson('panel.layout', state.root).catch(() => {})
  }, 500)
})
