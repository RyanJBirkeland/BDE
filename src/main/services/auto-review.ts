import type { AutoReviewRule } from '../../shared/types'

interface DiffFileSummary {
  path: string
  additions: number
  deletions: number
}

interface AutoReviewResult {
  rule: AutoReviewRule
  action: 'auto-merge' | 'auto-approve'
}

/**
 * Simple glob-to-regex: supports *.ext and **\/*.ext patterns.
 * *.ext matches any file ending with .ext in any directory
 * **\/*.ext matches any file ending with .ext in any nested directory
 */
function globMatch(pattern: string, filepath: string): boolean {
  // If pattern starts with *, it should match anywhere in the path
  if (pattern.startsWith('*') && !pattern.startsWith('**/')) {
    // *.ext pattern - match extension anywhere in path
    const ext = pattern.slice(1) // Remove leading *
    return filepath.endsWith(ext)
  }

  const escaped = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '(.+/)?')
    .replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`).test(filepath)
}

export function evaluateAutoReviewRules(
  rules: AutoReviewRule[],
  files: DiffFileSummary[]
): AutoReviewResult | null {
  for (const rule of rules) {
    if (!rule.enabled) continue

    const totalLines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0)

    // Check max lines
    if (
      rule.conditions.maxLinesChanged !== undefined &&
      totalLines > rule.conditions.maxLinesChanged
    ) {
      continue
    }

    // Check file patterns (all files must match at least one pattern)
    if (rule.conditions.filePatterns && rule.conditions.filePatterns.length > 0) {
      const allMatch = files.every((f) =>
        rule.conditions.filePatterns!.some((p) => globMatch(p, f.path))
      )
      if (!allMatch) continue
    }

    // Check exclude patterns (no file may match any exclude pattern)
    if (rule.conditions.excludePatterns && rule.conditions.excludePatterns.length > 0) {
      const anyExcluded = files.some((f) =>
        rule.conditions.excludePatterns!.some((p) => globMatch(p, f.path))
      )
      if (anyExcluded) continue
    }

    return { rule, action: rule.action }
  }

  return null
}
