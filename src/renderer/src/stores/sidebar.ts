import { create } from 'zustand'
import type { View } from './panelLayout'

const ALL_VIEWS: View[] = [
  'dashboard',
  'agents',
  'ide',
  'sprint',
  'code-review',
  'git',
  'settings',
  'task-workbench'
]

interface SidebarState {
  pinnedViews: View[]
  pinView: (view: View) => void
  unpinView: (view: View) => void
  reorderViews: (views: View[]) => void
  loadSaved: () => Promise<void>
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  pinnedViews: [...ALL_VIEWS],

  pinView: (view) => {
    const { pinnedViews } = get()
    if (pinnedViews.includes(view)) return
    set({ pinnedViews: [...pinnedViews, view] })
    persistPinned([...get().pinnedViews])
  },

  unpinView: (view) => {
    set((s) => ({ pinnedViews: s.pinnedViews.filter((v) => v !== view) }))
    persistPinned(get().pinnedViews)
  },

  reorderViews: (views) => {
    set({ pinnedViews: views })
    persistPinned(views)
  },

  loadSaved: async () => {
    try {
      const saved = await window.api.settings.getJson('sidebar.pinnedViews')
      if (Array.isArray(saved) && saved.length > 0) {
        // Filter to only valid views
        const valid = saved.filter((v: string) => ALL_VIEWS.includes(v as View)) as View[]
        if (valid.length > 0) set({ pinnedViews: valid })
      }
    } catch {
      // Use defaults
    }
  }
}))

function persistPinned(views: View[]): void {
  // settings.set expects a string value, settings.getJson parses it back
  // Verify this contract by reading src/preload/index.ts and src/main/handlers/config-handlers.ts
  window.api.settings.set('sidebar.pinnedViews', JSON.stringify(views)).catch(() => {})
}

/** Helper: get unpinned views (not stored, computed) */
export function getUnpinnedViews(pinned: View[]): View[] {
  return ALL_VIEWS.filter((v) => !pinned.includes(v))
}
