import type { AutoReviewRule } from '../../shared/types/task-types'
import { execFileAsync } from '../lib/async-utils'
import { buildAgentEnv } from '../env-utils'
import { resolveDefaultBranch } from '../lib/default-branch'
import { evaluateAutoReviewRules } from '../services/auto-review'

/**
 * `cssOnly` flags diffs that touch only stylesheet files. Downstream callers
 * can use this to skip the full test suite in the pre-push hook — CSS changes
 * cannot break unit/integration tests. The policy itself does not act on it.
 */
export interface AutoMergeDecision {
  shouldMerge: true
  ruleName: string
  cssOnly: boolean
}

export interface AutoMergeSkip {
  shouldMerge: false
  cssOnly: boolean
}

export type AutoMergePolicyResult = AutoMergeDecision | AutoMergeSkip

const STYLE_FILE_PATTERN = /\.(css|scss)$/i

/**
 * Returns true when every path in the diff is a stylesheet (.css or .scss).
 * Empty input returns false — "no changes" is not a CSS-only change.
 */
export function isCssOnlyChange(diffPaths: string[]): boolean {
  if (diffPaths.length === 0) return false
  return diffPaths.every((path) => STYLE_FILE_PATTERN.test(path))
}

async function getDiffFileStats(
  worktreePath: string
): Promise<Array<{ path: string; additions: number; deletions: number }> | null> {
  const env = buildAgentEnv()
  const defaultBranch = await resolveDefaultBranch(worktreePath)
  const { stdout: numstatOut } = await execFileAsync(
    'git',
    ['diff', '--numstat', `origin/${defaultBranch}...HEAD`],
    { cwd: worktreePath, env }
  )

  if (!numstatOut.trim()) {
    return null
  }

  return numstatOut
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t')
      const additionsText = parts[0] ?? ''
      const deletionsText = parts[1] ?? ''
      const additions = additionsText === '-' ? 0 : parseInt(additionsText, 10)
      const deletions = deletionsText === '-' ? 0 : parseInt(deletionsText, 10)
      const filePath = parts.slice(2).join('\t')
      return { path: filePath, additions, deletions }
    })
}

export async function evaluateAutoMergePolicy(
  rules: AutoReviewRule[],
  worktreePath: string
): Promise<AutoMergePolicyResult> {
  if (rules.length === 0) {
    return { shouldMerge: false, cssOnly: false }
  }

  const files = await getDiffFileStats(worktreePath)
  if (!files) {
    return { shouldMerge: false, cssOnly: false }
  }

  const cssOnly = isCssOnlyChange(files.map((f) => f.path))

  const result = evaluateAutoReviewRules(rules, files)

  if (result && result.action === 'auto-merge') {
    return { shouldMerge: true, ruleName: result.rule.name, cssOnly }
  }

  return { shouldMerge: false, cssOnly }
}
