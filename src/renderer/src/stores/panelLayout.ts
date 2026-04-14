import { create } from 'zustand'
import { toast } from './toasts'
import { loadLayout, createLayoutPersister } from './panel-persistence'
import {
  _resetIdCounter,
  createLeaf,
  findLeaf,
  findFirstLeaf,
  getOpenViews,
  splitNode,
  addTab,
  closeTab,
  setActiveTab,
  moveTab,
  migrateLayout,
  isValidLayout,
  DEFAULT_LAYOUT
} from './panel-tree'
import type { PanelNode, PanelLeafNode, PanelTab, PanelSplitNode } from './panel-tree'
import type { View, DropZone } from '../lib/view-types'

// Re-export for backward compatibility
export type { View, DropZone }
export type { PanelNode, PanelLeafNode, PanelTab, PanelSplitNode }
export {
  _resetIdCounter,
  createLeaf,
  findLeaf,
  findFirstLeaf,
  getOpenViews,
  splitNode,
  addTab,
  closeTab,
  setActiveTab,
  moveTab,
  migrateLayout,
  isValidLayout,
  DEFAULT_LAYOUT
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

interface PanelLayoutState {
  root: PanelNode
  focusedPanelId: string | null
  activeView: View

  splitPanel: (targetId: string, direction: 'horizontal' | 'vertical', viewKey: View) => void
  closeTab: (targetId: string, tabIndex: number) => void
  addTab: (targetId: string, viewKey: View) => void
  setActiveTab: (panelId: string, tabIndex: number) => void
  moveTab: (
    sourcePanelId: string,
    sourceTabIndex: number,
    targetPanelId: string,
    zone: DropZone
  ) => void
  focusPanel: (panelId: string) => void
  resetLayout: () => void
  loadSavedLayout: () => Promise<void>
  findPanelByView: (viewKey: View) => PanelLeafNode | null
  getOpenViews: () => View[]
  setView: (view: View) => void
  persistable: boolean
  setPersistable: (value: boolean) => void
}

export const usePanelLayoutStore = create<PanelLayoutState>((set, get) => ({
  root: DEFAULT_LAYOUT,
  focusedPanelId: (DEFAULT_LAYOUT as PanelLeafNode).panelId,
  activeView: 'agents',
  persistable: true,
  setPersistable: (value) => set({ persistable: value }),

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
      if (newRoot === null) {
        // Last tab removed — replace with dashboard
        const fresh = createLeaf('dashboard')
        return { root: fresh, focusedPanelId: fresh.panelId, activeView: 'dashboard' }
      }
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
      const leaf = findLeaf(newRoot, panelId)
      const activeTab = leaf?.tabs[tabIndex]
      const isFocused = s.focusedPanelId === panelId
      return {
        root: newRoot,
        ...(isFocused && activeTab ? { activeView: activeTab.viewKey } : {})
      }
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
    set((s) => {
      const focused = findLeaf(s.root, panelId)
      const activeTab = focused?.tabs[focused.activeTab]
      return {
        focusedPanelId: panelId,
        ...(activeTab ? { activeView: activeTab.viewKey } : {})
      }
    })
  },

  resetLayout: (): void => {
    _resetIdCounter()
    const fresh = createLeaf('dashboard')
    set({ root: fresh, focusedPanelId: fresh.panelId, activeView: 'dashboard' })
    if (typeof window !== 'undefined' && window.api?.settings) {
      window.api.settings.setJson('panel.layout', null).catch((err) => {
        console.error('Failed to clear panel layout:', err)
        toast.error('Settings save failed — changes may be lost on restart')
      })
    }
  },

  loadSavedLayout: async (): Promise<void> => {
    try {
      const saved = await loadLayout()
      if (saved && isValidLayout(saved)) {
        const raw = saved as PanelNode
        const root = migrateLayout(raw)
        const firstLeaf = findFirstLeaf(root)
        const activeTab = firstLeaf?.tabs[firstLeaf.activeTab]
        set({
          root,
          focusedPanelId: firstLeaf?.panelId ?? '',
          ...(activeTab ? { activeView: activeTab.viewKey } : {})
        })
      }
    } catch (err) {
      console.error('Failed to load saved panel layout:', err)
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

  setView: (view): void => {
    const store = get()
    const existing = store.findPanelByView(view)

    if (existing) {
      // Panel with this view already exists - focus it and activate the tab
      const leaf = findLeaf(store.root, existing.panelId)
      if (leaf) {
        const tabIdx = leaf.tabs.findIndex((t) => t.viewKey === view)
        if (tabIdx >= 0 && tabIdx !== leaf.activeTab) {
          // Need to update root and focus
          const newRoot = setActiveTab(store.root, existing.panelId, tabIdx)
          set({
            root: newRoot ?? store.root,
            focusedPanelId: existing.panelId,
            activeView: view
          })
        } else {
          // Just need to focus (tab already active)
          set({
            focusedPanelId: existing.panelId,
            activeView: view
          })
        }
      } else {
        // Leaf not found, just update activeView
        set({ activeView: view })
      }
    } else {
      // View doesn't exist - add it as a new tab
      const { focusedPanelId, root } = store
      const targetId = focusedPanelId ?? (root.type === 'leaf' ? root.panelId : '')
      const newRoot = addTab(root, targetId, view)
      set({
        root: newRoot ?? root,
        activeView: view
      })
    }
  }
}))

// ---------------------------------------------------------------------------
// Persist layout on every mutation (debounced)
// ---------------------------------------------------------------------------

const layoutPersister = createLayoutPersister(500)
let lastLayoutToSave: PanelNode | null = null

usePanelLayoutStore.subscribe((state) => {
  if (!state.persistable) return
  if (typeof window === 'undefined' || !window.api?.settings) return
  lastLayoutToSave = state.root
  layoutPersister.persist(state.root)
})

// Flush pending layout persistence on window close/reload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    layoutPersister.flush(lastLayoutToSave)
  })
}
