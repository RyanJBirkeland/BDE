import { create } from 'zustand'

interface Flags {
  v2Shell: boolean
  v2Dashboard: boolean
  v2Pipeline: boolean
  v2Agents: boolean
  v2Planner: boolean
}

interface FeatureFlagState extends Flags {
  setFlag: <K extends keyof Flags>(key: K, value: Flags[K]) => void
}

const STORAGE_KEY = 'fleet:ff'

const defaultFlags: Flags = {
  v2Shell: true,
  v2Dashboard: true,
  v2Pipeline: true,
  v2Agents: true,
  v2Planner: true
}

function validatedFlag<K extends keyof Flags>(parsed: unknown, key: K): Flags[K] {
  if (typeof parsed !== 'object' || parsed === null) return defaultFlags[key]
  const value = (parsed as Record<string, unknown>)[key]
  return typeof value === 'boolean' ? (value as Flags[K]) : defaultFlags[key]
}

function loadFlags(): Flags {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...defaultFlags }
    const parsed: unknown = JSON.parse(stored)
    return {
      v2Shell: validatedFlag(parsed, 'v2Shell'),
      v2Dashboard: validatedFlag(parsed, 'v2Dashboard'),
      v2Pipeline: validatedFlag(parsed, 'v2Pipeline'),
      v2Agents: validatedFlag(parsed, 'v2Agents'),
      v2Planner: validatedFlag(parsed, 'v2Planner')
    }
  } catch {
    return { ...defaultFlags }
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
      persistFlags({
        v2Shell: next.v2Shell,
        v2Dashboard: next.v2Dashboard,
        v2Pipeline: next.v2Pipeline,
        v2Agents: next.v2Agents,
        v2Planner: next.v2Planner
      })
      return { [key]: value }
    })
}))
