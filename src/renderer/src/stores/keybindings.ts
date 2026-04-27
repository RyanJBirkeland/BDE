import { create } from 'zustand'
import { getSetting, setSetting } from '../services/settings-storage'

/**
 * Keybindings store — manages customizable keyboard shortcuts.
 * Persists to SQLite settings table via window.api.settings.
 */

export type ActionId =
  | 'view.dashboard'
  | 'view.agents'
  | 'view.ide'
  | 'view.sprint'
  | 'view.codeReview'
  | 'view.git'
  | 'view.settings'
  | 'view.planner'
  | 'palette.toggle'
  | 'quickCreate.toggle'
  | 'refresh'
  | 'panel.splitRight'
  | 'panel.closeTab'
  | 'panel.nextTab'
  | 'panel.prevTab'
  | 'shortcuts.show'
  | 'settings.open'

export interface Keybinding {
  actionId: ActionId
  label: string
  combo: string // Display format (e.g., '⌘1', 'Cmd+P')
}

export const DEFAULT_KEYBINDINGS: Record<ActionId, string> = {
  'view.dashboard': '⌘1',
  'view.agents': '⌘2',
  'view.ide': '⌘3',
  'view.sprint': '⌘4',
  'view.codeReview': '⌘5',
  'view.git': '⌘6',
  'view.settings': '⌘7',
  'view.planner': '⌘8',
  'palette.toggle': '⌘P',
  'quickCreate.toggle': '⌘N',
  refresh: '⌘R',
  'panel.splitRight': '⌘\\',
  'panel.closeTab': '⌘W',
  'panel.nextTab': '⌘⇧]',
  'panel.prevTab': '⌘⇧[',
  'shortcuts.show': '?',
  'settings.open': '⌘,'
}

export const ACTION_LABELS: Record<ActionId, string> = {
  'view.dashboard': 'Go to Dashboard',
  'view.agents': 'Go to Agents',
  'view.ide': 'Go to IDE',
  'view.sprint': 'Go to Task Pipeline',
  'view.codeReview': 'Go to Code Review',
  'view.git': 'Go to Source Control',
  'view.settings': 'Go to Settings',
  'view.planner': 'Go to Task Planner',
  'palette.toggle': 'Toggle Command Palette',
  'quickCreate.toggle': 'Toggle Quick Create',
  refresh: 'Refresh Current View',
  'panel.splitRight': 'Split Panel Right',
  'panel.closeTab': 'Close Panel Tab',
  'panel.nextTab': 'Next Tab',
  'panel.prevTab': 'Previous Tab',
  'shortcuts.show': 'Show Keyboard Shortcuts',
  'settings.open': 'Open Settings'
}

interface KeybindingsStore {
  bindings: Record<ActionId, string>
  init: () => Promise<void>
  getBinding: (actionId: ActionId) => string
  setBinding: (actionId: ActionId, combo: string) => Promise<void>
  resetToDefaults: () => Promise<void>
  findDuplicates: () => Array<{ combo: string; actions: ActionId[] }>
}

export const useKeybindingsStore = create<KeybindingsStore>((set, get) => ({
  bindings: { ...DEFAULT_KEYBINDINGS },

  init: async () => {
    try {
      const saved = await getSetting('keybindings')
      if (saved) {
        const parsed = JSON.parse(saved) as Record<ActionId, string>
        // Merge with defaults to handle new actions added in updates
        const merged = { ...DEFAULT_KEYBINDINGS, ...parsed }
        set({ bindings: merged })
      }
    } catch (err) {
      console.error('Failed to load keybindings:', err)
    }
  },

  getBinding: (actionId) => get().bindings[actionId] ?? DEFAULT_KEYBINDINGS[actionId],

  setBinding: async (actionId, combo) => {
    const updated = { ...get().bindings, [actionId]: combo }
    set({ bindings: updated })
    try {
      await setSetting('keybindings', JSON.stringify(updated))
    } catch (err) {
      console.error('Failed to save keybindings:', err)
    }
  },

  resetToDefaults: async () => {
    set({ bindings: { ...DEFAULT_KEYBINDINGS } })
    try {
      await setSetting('keybindings', JSON.stringify(DEFAULT_KEYBINDINGS))
    } catch (err) {
      console.error('Failed to reset keybindings:', err)
    }
  },

  findDuplicates: () => {
    const { bindings } = get()
    const comboMap = new Map<string, ActionId[]>()

    for (const [actionId, combo] of Object.entries(bindings)) {
      const existing = comboMap.get(combo) ?? []
      existing.push(actionId as ActionId)
      comboMap.set(combo, existing)
    }

    return Array.from(comboMap.entries())
      .filter(([_, actions]) => actions.length > 1)
      .map(([combo, actions]) => ({ combo, actions }))
  }
}))
