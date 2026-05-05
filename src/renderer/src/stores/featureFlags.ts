import { create } from 'zustand'

interface Flags {
  v2Shell: boolean
}

interface FeatureFlagState extends Flags {
  setFlag: <K extends keyof Flags>(key: K, value: Flags[K]) => void
}

const STORAGE_KEY = 'fleet:ff'

function loadFlags(): Flags {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { v2Shell: false }
    const parsed = JSON.parse(stored) as Partial<Flags>
    return { v2Shell: parsed.v2Shell ?? false }
  } catch {
    return { v2Shell: false }
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
      persistFlags({ v2Shell: next.v2Shell })
      return { [key]: value }
    }),
}))
