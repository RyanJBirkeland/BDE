import { useEffect } from 'react'
import { useTaskWorkbenchStore, type CheckResult } from '../stores/taskWorkbench'
import {
  MIN_SPEC_LENGTH,
  MIN_HEADING_COUNT,
  getValidationProfile,
  type SpecType
} from '../../../shared/spec-validation'

// Tier 1: Structural checks (pure, synchronous, runs on every form change)

interface FormSnapshot {
  title: string
  repo: string
  spec: string
}

export function computeStructuralChecks(form: FormSnapshot, specType?: SpecType | null): CheckResult[] {
  // When specType is explicitly provided (including null), use the validation profile.
  // When specType is undefined (legacy call with no second arg), use legacy permissive behavior.
  const useProfile = specType !== undefined
  const profile = useProfile ? getValidationProfile(specType ?? null) : null
  const checks: CheckResult[] = []

  // Title present
  checks.push({
    id: 'title-present',
    label: 'Title',
    tier: 1,
    status: form.title.trim() ? 'pass' : 'fail',
    message: form.title.trim() ? 'Title provided' : 'Title is required'
  })

  // Repo selected
  checks.push({
    id: 'repo-selected',
    label: 'Repo',
    tier: 1,
    status: form.repo ? 'pass' : 'fail',
    message: form.repo ? `Repo: ${form.repo}` : 'No repo selected'
  })

  // Spec present
  const specLen = form.spec.trim().length
  let specStatus: 'pass' | 'warn' | 'fail'
  let specMsg: string
  if (profile) {
    // Profile-aware: use threshold and behavior from profile
    const specThreshold = profile.specPresent.threshold ?? MIN_SPEC_LENGTH
    const specAdvisory = profile.specPresent.behavior === 'advisory'
    if (specLen === 0) {
      specStatus = specAdvisory ? 'warn' : 'fail'
      specMsg = 'Spec is empty'
    } else if (specLen <= specThreshold) {
      specStatus = specAdvisory ? 'warn' : 'fail'
      specMsg = 'Spec is very short — consider adding more detail'
    } else {
      specStatus = 'pass'
      specMsg = `Spec: ${specLen} characters`
    }
  } else {
    // Legacy behavior (no specType provided): empty=fail, short=warn, adequate=pass
    if (specLen === 0) {
      specStatus = 'fail'
      specMsg = 'Spec is empty'
    } else if (specLen <= MIN_SPEC_LENGTH) {
      specStatus = 'warn'
      specMsg = 'Spec is very short — consider adding more detail'
    } else {
      specStatus = 'pass'
      specMsg = `Spec: ${specLen} characters`
    }
  }
  checks.push({ id: 'spec-present', label: 'Spec', tier: 1, status: specStatus, message: specMsg })

  // Spec has structure (markdown headings)
  const skipStructure = profile && profile.specStructure.behavior === 'skip'
  if (!skipStructure) {
    const headingThreshold = profile ? (profile.specStructure.threshold ?? MIN_HEADING_COUNT) : MIN_HEADING_COUNT
    const structureAdvisory = profile ? profile.specStructure.behavior === 'advisory' : false
    const headingCount = (form.spec.match(/^## /gm) ?? []).length
    let structureStatus: 'pass' | 'warn' | 'fail'
    let structureMsg: string
    if (headingCount >= headingThreshold) {
      structureStatus = 'pass'
      structureMsg = `${headingCount} sections`
    } else if (headingCount === 1) {
      structureStatus = 'warn'
      structureMsg = 'Only 1 section — consider adding Problem/Solution/Files structure'
    } else {
      structureStatus = structureAdvisory ? 'warn' : 'fail'
      structureMsg = 'No sections — use ## headings to structure the spec'
    }
    checks.push({
      id: 'spec-structure',
      label: 'Structure',
      tier: 1,
      status: structureStatus,
      message: structureMsg
    })
  }

  return checks
}

// React hook — wires structural checks to store on every form change

export function useReadinessChecks(): void {
  const title = useTaskWorkbenchStore((s) => s.title)
  const repo = useTaskWorkbenchStore((s) => s.repo)
  const spec = useTaskWorkbenchStore((s) => s.spec)
  const specType = useTaskWorkbenchStore((s) => s.specType)
  const setStructuralChecks = useTaskWorkbenchStore((s) => s.setStructuralChecks)

  useEffect(() => {
    const checks = computeStructuralChecks({ title, repo, spec }, specType)
    setStructuralChecks(checks)
  }, [title, repo, spec, specType, setStructuralChecks])
}
