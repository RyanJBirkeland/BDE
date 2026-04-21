import { execFileAsync } from '../lib/async-utils'
import { evaluateAutoReviewRules } from './auto-review'
import type { AutoReviewRule } from '../../shared/types'

export interface CheckAutoReviewParams {
  worktreePath: string
  rules: AutoReviewRule[]
  env: NodeJS.ProcessEnv
}

export interface CheckAutoReviewResult {
  shouldAutoMerge: boolean
  shouldAutoApprove: boolean
  matchedRule: string | null
}

function parseNumstatSimple(
  numstatOut: string
): Array<{ path: string; additions: number; deletions: number }> {
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

export async function checkAutoReview(
  params: CheckAutoReviewParams
): Promise<CheckAutoReviewResult> {
  const { worktreePath, rules, env } = params

  const { stdout: numstatOut } = await execFileAsync(
    'git',
    ['diff', '--numstat', 'origin/main...HEAD'],
    { cwd: worktreePath, env }
  )

  if (!numstatOut.trim()) {
    return { shouldAutoMerge: false, shouldAutoApprove: false, matchedRule: null }
  }

  const files = parseNumstatSimple(numstatOut)
  const result = evaluateAutoReviewRules(rules, files)

  if (!result) {
    return { shouldAutoMerge: false, shouldAutoApprove: false, matchedRule: null }
  }

  return {
    shouldAutoMerge: result.action === 'auto-merge',
    shouldAutoApprove: result.action === 'auto-approve',
    matchedRule: result.rule.name
  }
}
