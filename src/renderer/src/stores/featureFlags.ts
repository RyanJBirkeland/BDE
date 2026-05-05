import { create } from 'zustand'

interface Flags {
  v2Shell: boolean
  v2Dashboard: boolean
  v2Pipeline: boolean
}

interface FeatureFlagState extends Flags {
  setFlag: <K extends keyof Flags>(key: K, value: Flags[K]) => void
}

const STORAGE_KEY = 'fleet:ff'

function loadFlags(): Flags {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { v2Shell: false, v2Dashboard: false, v2Pipeline: false }
    const parsed = JSON.parse(stored) as Partial<Flags>
    return {
      v2Shell: parsed.v2Shell ?? false,
      v2Dashboard: parsed.v2Dashboard ?? false,
      v2Pipeline: parsed.v2Pipeline ?? false,
    }
  } catch {
    return { v2Shell: false, v2Dashboard: false, v2Pipeline: false }
  }
}

function persistFlags(flags: Flags): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags))
  } catch {
    /* localStorage may be unavailable */
  }
}

const initialFlags = loadFlags()

export const useFeatureFlags = create<FeatureFlagState>((set) => ({
  ...initialFlags,
  setFlag: (key, value) =>
    set((state) => {
      const next = { ...state, [key]: value }
      persistFlags({ v2Shell: next.v2Shell, v2Dashboard: next.v2Dashboard, v2Pipeline: next.v2Pipeline })
      return { [key]: value }
    }),
}))
