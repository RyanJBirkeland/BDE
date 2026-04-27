import type { SprintTask } from '../../shared/types/task-types'
import path from 'node:path'

const SPEC_TYPE_TO_COMMIT_TYPE: Record<string, string> = {
  feature: 'feat',
  'bug-fix': 'fix',
  refactor: 'refactor',
  'test-coverage': 'test',
  freeform: 'chore',
  prompt: 'chore'
}

const TASK_TITLE_PREFIX_PATTERN = /^(T|PR)-\d+\s*\[P\d\]\s*/

/**
 * Build a BDE-convention commit message for an auto-commit.
 *
 * Format: `${type}(${scope}): ${subject}\n\nTask-Id: ${task.id}`
 *
 * - type:    mapped from spec_type; unknown types fall back to 'chore'
 * - scope:   basename (no extension, lowercase) of the first path under
 *            `## Files to Change`; falls back to 'agent' when none is found
 * - subject: task title with leading T-N [PN] / PR-N [PN] prefix stripped
 */
export function buildCommitMessage(task: SprintTask): string {
  const type = resolveCommitType(task.spec_type)
  const scope = resolveScope(task.spec)
  const subject = stripTaskPrefix(task.title)

  return `${type}(${scope}): ${subject}\n\nTask-Id: ${task.id}`
}

function resolveCommitType(specType: string | null | undefined): string {
  if (!specType) return 'chore'
  return SPEC_TYPE_TO_COMMIT_TYPE[specType] ?? 'chore'
}

function resolveScope(spec: string | null | undefined): string {
  if (!spec) return 'agent'
  const firstFile = extractFirstFileFromSpec(spec)
  if (!firstFile) return 'agent'
  return path.basename(firstFile, path.extname(firstFile)).toLowerCase()
}

function extractFirstFileFromSpec(spec: string): string | null {
  const sectionStart = spec.indexOf('## Files to Change')
  if (sectionStart === -1) return null

  const afterHeading = spec.slice(sectionStart + '## Files to Change'.length)
  const nextSection = afterHeading.search(/^##\s/m)
  const sectionBody = nextSection === -1 ? afterHeading : afterHeading.slice(0, nextSection)

  // Match the first path-like token: must contain a '/' and optionally a '.'
  const match = sectionBody.match(/[^\s`*\-[\](),]+\/[^\s`*\-[\](),]+/)
  return match ? match[0] : null
}

function stripTaskPrefix(title: string): string {
  return title.replace(TASK_TITLE_PREFIX_PATTERN, '').trim()
}
