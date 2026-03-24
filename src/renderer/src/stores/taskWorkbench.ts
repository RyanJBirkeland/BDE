import { create } from 'zustand'

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'pending'

export interface CheckResult {
  id: string
  label: string
  tier: 1 | 2 | 3
  status: CheckStatus
  message: string
}

interface TaskWorkbenchState {
  // Form fields
  title: string
  repo: string
  spec: string

  // Readiness checks
  structuralChecks: CheckResult[]

  // Actions
  setTitle: (title: string) => void
  setRepo: (repo: string) => void
  setSpec: (spec: string) => void
  setStructuralChecks: (checks: CheckResult[]) => void
  reset: () => void
}

const initialState = {
  title: '',
  repo: '',
  spec: '',
  structuralChecks: [],
}

export const useTaskWorkbenchStore = create<TaskWorkbenchState>((set) => ({
  ...initialState,

  setTitle: (title) => set({ title }),
  setRepo: (repo) => set({ repo }),
  setSpec: (spec) => set({ spec }),
  setStructuralChecks: (structuralChecks) => set({ structuralChecks }),
  reset: () => set(initialState),
}))
