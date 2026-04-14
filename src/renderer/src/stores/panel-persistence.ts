import { createDebouncedPersister } from '../lib/createDebouncedPersister'
import type { PanelNode } from './panel-tree'
import { setJsonSetting, getJsonSetting } from '../services/settings-storage'

// ---------------------------------------------------------------------------
// Layout persistence helpers — wraps IPC settings calls, no Zustand/React
// ---------------------------------------------------------------------------

/**
 * Saves layout to the settings store. Pass null to clear the saved layout.
 */
export function saveLayout(layout: PanelNode | null): void {
  setJsonSetting('panel.layout', layout).catch((err) => {
    console.error('Failed to save panel layout:', err)
  })
}

/**
 * Loads the saved layout from the settings store.
 * Returns null if no layout is saved or settings are unavailable.
 */
export async function loadLayout(): Promise<PanelNode | null> {
  const saved = await getJsonSetting<PanelNode>('panel.layout')
  return saved ?? null
}

export interface LayoutPersister {
  persist: (layout: PanelNode) => void
  flush: (layout: PanelNode | null) => void
  cancel: () => void
}

/**
 * Creates a debounced layout persister with flush-on-unload support.
 */
export function createLayoutPersister(delayMs = 500): LayoutPersister {
  const [debouncedSave, cancel] = createDebouncedPersister<PanelNode>((layout) => {
    saveLayout(layout)
  }, delayMs)

  const persist = (layout: PanelNode): void => {
    debouncedSave(layout)
  }

  const flush = (layout: PanelNode | null): void => {
    cancel()
    if (layout !== null) {
      saveLayout(layout)
    }
  }

  return { persist, flush, cancel }
}
