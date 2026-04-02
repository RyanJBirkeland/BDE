/**
 * Tier 1 structural validation for task specs.
 * Pure functions — no IPC, no side effects. Shared by renderer and main process.
 */

export interface StructuralCheckResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export const MIN_SPEC_LENGTH = 50
export const MIN_HEADING_COUNT = 2

export type SpecType =
  | 'feature'
  | 'bugfix'
  | 'refactor'
  | 'test'
  | 'performance'
  | 'ux'
  | 'audit'
  | 'infra'

export type CheckBehavior = 'required' | 'advisory' | 'skip'

export interface CheckConfig {
  behavior: CheckBehavior
  threshold?: number
}

export interface ValidationProfile {
  specPresent: CheckConfig
  specStructure: CheckConfig
  clarity: CheckConfig
  scope: CheckConfig
  filesExist: CheckConfig
}

const FEATURE_PROFILE: ValidationProfile = {
  specPresent: { behavior: 'required', threshold: 50 },
  specStructure: { behavior: 'required', threshold: 2 },
  clarity: { behavior: 'required' },
  scope: { behavior: 'required' },
  filesExist: { behavior: 'required' }
}

const REFACTOR_PROFILE: ValidationProfile = {
  specPresent: { behavior: 'required', threshold: 30 },
  specStructure: { behavior: 'advisory', threshold: 1 },
  clarity: { behavior: 'required' },
  scope: { behavior: 'advisory' },
  filesExist: { behavior: 'advisory' }
}

const TEST_PROFILE: ValidationProfile = {
  specPresent: { behavior: 'advisory', threshold: 20 },
  specStructure: { behavior: 'advisory', threshold: 1 },
  clarity: { behavior: 'advisory' },
  scope: { behavior: 'advisory' },
  filesExist: { behavior: 'skip' }
}

const LIGHTWEIGHT_PROFILE: ValidationProfile = {
  specPresent: { behavior: 'advisory', threshold: 20 },
  specStructure: { behavior: 'advisory', threshold: 1 },
  clarity: { behavior: 'advisory' },
  scope: { behavior: 'advisory' },
  filesExist: { behavior: 'skip' }
}

const VALIDATION_PROFILES: Record<SpecType, ValidationProfile> = {
  feature: FEATURE_PROFILE,
  bugfix: { ...FEATURE_PROFILE },
  refactor: REFACTOR_PROFILE,
  test: TEST_PROFILE,
  performance: FEATURE_PROFILE,
  ux: FEATURE_PROFILE,
  audit: LIGHTWEIGHT_PROFILE,
  infra: LIGHTWEIGHT_PROFILE
}

export function getValidationProfile(specType: SpecType | null | undefined): ValidationProfile {
  if (!specType) return FEATURE_PROFILE
  return VALIDATION_PROFILES[specType] ?? FEATURE_PROFILE
}

export function validateStructural(input: {
  title?: string | null
  repo?: string | null
  spec?: string | null
  status?: string | null // if 'backlog', relax spec requirements
  specType?: SpecType | null
}): StructuralCheckResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Title present — always enforced
  if (!input.title || !input.title.trim()) {
    errors.push('title is required')
  }

  // Repo present — always enforced
  if (!input.repo || !input.repo.trim()) {
    errors.push('repo is required')
  }

  // Spec checks — only enforced when status !== 'backlog'
  if (input.status !== 'backlog') {
    const profile = getValidationProfile(input.specType ?? null)
    const specThreshold = profile.specPresent.threshold ?? MIN_SPEC_LENGTH
    const headingThreshold = profile.specStructure.threshold ?? MIN_HEADING_COUNT

    const specLen = (input.spec ?? '').trim().length
    if (specLen === 0) {
      errors.push('spec is required')
    } else if (specLen < specThreshold) {
      const msg = `spec is too short (${specLen} chars, minimum ${specThreshold}). Add problem context, solution approach, and files to modify.`
      if (profile.specPresent.behavior === 'advisory') {
        warnings.push(msg)
      } else {
        errors.push(msg)
      }
    }

    if (specLen > 0) {
      const headingCount = ((input.spec ?? '').match(/^## /gm) ?? []).length
      if (headingCount < headingThreshold) {
        const msg = `spec needs at least ${headingThreshold} markdown sections (## headings). Use ## Problem, ## Solution, ## Files structure.`
        if (profile.specStructure.behavior === 'advisory') {
          warnings.push(msg)
        } else {
          errors.push(msg)
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}
