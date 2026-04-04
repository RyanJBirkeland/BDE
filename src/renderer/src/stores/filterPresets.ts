import { create } from 'zustand'
import { useSprintUI, type StatusFilter } from './sprintUI'

const STORAGE_KEY = 'bde:filterPresets'

export interface FilterPreset {
  repoFilter: string | null
  searchQuery: string
  statusFilter: StatusFilter
}

interface FilterPresetsState {
  presets: Record<string, FilterPreset>
  savePreset: (name: string) => void
  loadPreset: (name: string) => void
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
    } catch {
      // Ignore quota errors
    }
  }, 500)
}

export const useFilterPresets = create<FilterPresetsState>((set, get) => ({
  presets: {},

  savePreset: (name): void => {
    const { repoFilter, searchQuery, statusFilter } = useSprintUI.getState()
    const preset: FilterPreset = { repoFilter, searchQuery, statusFilter }

    set((s) => {
      const newPresets = { ...s.presets, [name]: preset }
      debouncedPersist(newPresets)
      return { presets: newPresets }
    })
  },

  loadPreset: (name): void => {
    const preset = get().presets[name]
    if (!preset) return

    useSprintUI.setState({
      repoFilter: preset.repoFilter,
      searchQuery: preset.searchQuery,
      statusFilter: preset.statusFilter
    })
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
    } catch {
      // Ignore parse errors
    }
  }
}))
