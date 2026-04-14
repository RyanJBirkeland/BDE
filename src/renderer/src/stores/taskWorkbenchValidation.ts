import { create } from 'zustand'
import type { CheckResult } from './taskWorkbench'

interface TaskWorkbenchValidationState {
  structuralChecks: CheckResult[]
  semanticChecks: CheckResult[]
  operationalChecks: CheckResult[]
  semanticLoading: boolean
  operationalLoading: boolean

  setStructuralChecks: (checks: CheckResult[]) => void
  setSemanticChecks: (checks: CheckResult[]) => void
  setOperationalChecks: (checks: CheckResult[]) => void
}

export const useTaskWorkbenchValidation = create<TaskWorkbenchValidationState>((set) => ({
  structuralChecks: [],
  semanticChecks: [],
  operationalChecks: [],
  semanticLoading: false,
  operationalLoading: false,

  setStructuralChecks: (checks) => set({ structuralChecks: checks }),
  setSemanticChecks: (checks) => set({ semanticChecks: checks, semanticLoading: false }),
  setOperationalChecks: (checks) => set({ operationalChecks: checks, operationalLoading: false })
}))
