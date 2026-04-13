import { create } from 'zustand'
import type { StatusFilter } from './sprintUI'

const STORAGE_KEY = 'bde:filterPresets'

export interface FilterPreset {
  repoFilter: string | null
  searchQuery: string
  statusFilter: StatusFilter
}

interface FilterPresetsState {
  presets: Record<string, FilterPreset>
  savePreset: (name: string, preset: FilterPreset) => void
  loadPreset: (name: string) => FilterPreset | null
  deletePreset: (name: string) => void
  getPresetNames: () => string[]
  restoreFromStorage: () => void
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function debouncedPersist(presets: Record<string, FilterPreset>): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(presets))
    } catch (err) {
      console.error('Failed to persist filter presets:', err)
    }
  }, 500)
}

export const useFilterPresets = create<FilterPresetsState>((set, get) => ({
  presets: {},

  savePreset: (name, preset): void => {
    set((s) => {
      const newPresets = { ...s.presets, [name]: preset }
      debouncedPersist(newPresets)
      return { presets: newPresets }
    })
  },

  loadPreset: (name): FilterPreset | null => {
    return get().presets[name] || null
  },

  deletePreset: (name): void => {
    set((s) => {
      const { [name]: _, ...rest } = s.presets
      debouncedPersist(rest)
      return { presets: rest }
    })
  },

  getPresetNames: (): string[] => {
    return Object.keys(get().presets)
  },

  restoreFromStorage: (): void => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return

      const parsed = JSON.parse(raw)

      // Validate that parsed is a plain object
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return
      }

      set({ presets: parsed })
    } catch (err) {
      console.error('Failed to load filter presets:', err)
    }
  }
}))
