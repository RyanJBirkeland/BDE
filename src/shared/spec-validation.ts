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

export function validateStructural(input: {
  title?: string | null
  repo?: string | null
  spec?: string | null
  status?: string | null // if 'backlog', relax spec requirements
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
    const specLen = (input.spec ?? '').trim().length
    if (specLen === 0) {
      errors.push('spec is required')
    } else if (specLen < MIN_SPEC_LENGTH) {
      errors.push(
        `spec is too short (${specLen} chars, minimum ${MIN_SPEC_LENGTH}). Add problem context, solution approach, and files to modify.`
      )
    }

    if (specLen > 0) {
      const headingCount = ((input.spec ?? '').match(/^## /gm) ?? []).length
      if (headingCount < MIN_HEADING_COUNT) {
        errors.push(
          `spec needs at least ${MIN_HEADING_COUNT} markdown sections (## headings). Use ## Problem, ## Solution, ## Files structure.`
        )
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}
