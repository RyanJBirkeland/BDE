import { describe, it, expect, beforeEach } from 'vitest'
import { useTaskWorkbenchValidation } from '../taskWorkbenchValidation'
import type { CheckResult } from '../taskWorkbench'

beforeEach(() => {
  useTaskWorkbenchValidation.setState({
    structuralChecks: [],
    semanticChecks: [],
    operationalChecks: [],
    semanticLoading: false,
    operationalLoading: false
  })
})

function makeCheck(label: string, passed: boolean): CheckResult {
  return { label, passed, message: passed ? 'OK' : 'Failed' }
}

describe('useTaskWorkbenchValidation', () => {
  it('starts with all check arrays empty and loading flags false', () => {
    const state = useTaskWorkbenchValidation.getState()
    expect(state.structuralChecks).toHaveLength(0)
    expect(state.semanticChecks).toHaveLength(0)
    expect(state.operationalChecks).toHaveLength(0)
    expect(state.semanticLoading).toBe(false)
    expect(state.operationalLoading).toBe(false)
  })

  it('setStructuralChecks stores the checks', () => {
    const checks = [makeCheck('Has title', true), makeCheck('Has spec', false)]
    useTaskWorkbenchValidation.getState().setStructuralChecks(checks)
    expect(useTaskWorkbenchValidation.getState().structuralChecks).toEqual(checks)
  })

  it('setSemanticChecks stores checks and sets semanticLoading=false', () => {
    useTaskWorkbenchValidation.setState({ semanticLoading: true })
    const checks = [makeCheck('Prescriptive', true)]
    useTaskWorkbenchValidation.getState().setSemanticChecks(checks)
    const state = useTaskWorkbenchValidation.getState()
    expect(state.semanticChecks).toEqual(checks)
    expect(state.semanticLoading).toBe(false)
  })

  it('setOperationalChecks stores checks and sets operationalLoading=false', () => {
    useTaskWorkbenchValidation.setState({ operationalLoading: true })
    const checks = [makeCheck('Repo exists', true)]
    useTaskWorkbenchValidation.getState().setOperationalChecks(checks)
    const state = useTaskWorkbenchValidation.getState()
    expect(state.operationalChecks).toEqual(checks)
    expect(state.operationalLoading).toBe(false)
  })

  it('readiness gate: all checks pass when all structural checks pass', () => {
    useTaskWorkbenchValidation.getState().setStructuralChecks([
      makeCheck('Has title', true),
      makeCheck('Has spec', true)
    ])
    const allPassed = useTaskWorkbenchValidation
      .getState()
      .structuralChecks.every((c) => c.passed)
    expect(allPassed).toBe(true)
  })

  it('readiness gate: fails when any structural check fails', () => {
    useTaskWorkbenchValidation.getState().setStructuralChecks([
      makeCheck('Has title', true),
      makeCheck('Min spec length', false)
    ])
    const allPassed = useTaskWorkbenchValidation
      .getState()
      .structuralChecks.every((c) => c.passed)
    expect(allPassed).toBe(false)
  })
})
