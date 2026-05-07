import { createDebouncedPersister } from '../lib/createDebouncedPersister'
import type { PanelNode } from './panel-tree'
import { setJsonSetting, getJsonSetting } from '../services/settings-storage'

function isPanelNode(value: unknown): value is PanelNode {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.type === 'leaf' || candidate.type === 'split'
}

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
 * Saves layout to the settings store and surfaces errors to the caller via the
 * returned promise. Use when the caller needs to react to failure (e.g. show a toast).
 */
export function saveLayoutAsync(layout: PanelNode | null): Promise<void> {
  return setJsonSetting('panel.layout', layout)
}

/**
 * Loads the saved layout from the settings store.
 * Returns null if no layout is saved or settings are unavailable.
 */
export async function loadLayout(): Promise<PanelNode | null> {
  const saved = await getJsonSetting<PanelNode>('panel.layout', isPanelNode)
  return saved ?? null
}

export interface LayoutPersister {
  persist: (layout: PanelNode) => void
  flush: (layout: PanelNode | null) => void
  clear: () => Promise<void>
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

  // Cancels any pending debounced write so it cannot overwrite the cleared value,
  // then writes null to wipe the saved layout. Returns the underlying save promise
  // so callers can react to failure (e.g. show a toast).
  const clear = (): Promise<void> => {
    cancel()
    return saveLayoutAsync(null)
  }

  return { persist, flush, clear, cancel }
}
