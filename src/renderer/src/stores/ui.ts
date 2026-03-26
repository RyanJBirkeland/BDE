import { create } from 'zustand'
import { usePanelLayoutStore, findLeaf } from './panelLayout'
export type { View } from './panelLayout'
import type { View } from './panelLayout'

interface UIStore {
  activeView: View
  setView: (view: View) => void
}

function getFocusedPanelId(): string {
  const { root, focusedPanelId } = usePanelLayoutStore.getState()
  if (focusedPanelId) return focusedPanelId
  // Fall back to the root leaf if there's no focused panel yet
  if (root.type === 'leaf') return root.panelId
  return ''
}

export const useUIStore = create<UIStore>((set) => ({
  activeView: 'agents',
  setView: (view: View) => {
    const store = usePanelLayoutStore.getState()
    const existing = store.findPanelByView(view)
    if (existing) {
      store.focusPanel(existing.panelId)
      const leaf = findLeaf(store.root, existing.panelId)
      if (leaf) {
        const tabIdx = leaf.tabs.findIndex((t) => t.viewKey === view)
        if (tabIdx >= 0 && tabIdx !== leaf.activeTab) {
          store.setActiveTab(existing.panelId, tabIdx)
        }
      }
    } else {
      store.addTab(getFocusedPanelId(), view)
    }
    set({ activeView: view })
  }
}))

// Keep activeView in sync when panel focus changes
usePanelLayoutStore.subscribe((state) => {
  const focused = findLeaf(state.root, state.focusedPanelId ?? '')
  if (focused) {
    const activeTab = focused.tabs[focused.activeTab]
    if (activeTab) {
      useUIStore.setState({ activeView: activeTab.viewKey })
    }
  }
})
