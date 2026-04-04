import { describe, it, expect } from 'vitest'
import { evaluateAutoReviewRules } from '../auto-review'
import type { AutoReviewRule } from '../../../shared/types'

describe('evaluateAutoReviewRules', () => {
  const cssOnlyRule: AutoReviewRule = {
    id: 'r1',
    name: 'CSS-only auto-merge',
    enabled: true,
    conditions: {
      maxLinesChanged: 10,
      filePatterns: ['*.css']
    },
    action: 'auto-merge'
  }

  it('returns matching rule when all conditions met', () => {
    const files = [{ path: 'src/style.css', additions: 3, deletions: 2 }]
    const result = evaluateAutoReviewRules([cssOnlyRule], files)
    expect(result).not.toBeNull()
    expect(result!.rule.id).toBe('r1')
  })

  it('returns null when line count exceeds max', () => {
    const files = [{ path: 'src/style.css', additions: 8, deletions: 5 }]
    const result = evaluateAutoReviewRules([cssOnlyRule], files)
    expect(result).toBeNull()
  })

  it('returns null when files do not match pattern', () => {
    const files = [{ path: 'src/main.ts', additions: 2, deletions: 1 }]
    const result = evaluateAutoReviewRules([cssOnlyRule], files)
    expect(result).toBeNull()
  })

  it('skips disabled rules', () => {
    const disabled = { ...cssOnlyRule, enabled: false }
    const files = [{ path: 'src/style.css', additions: 1, deletions: 0 }]
    const result = evaluateAutoReviewRules([disabled], files)
    expect(result).toBeNull()
  })

  it('returns null when no rules configured', () => {
    const files = [{ path: 'src/main.ts', additions: 1, deletions: 0 }]
    const result = evaluateAutoReviewRules([], files)
    expect(result).toBeNull()
  })

  it('respects excludePatterns', () => {
    const rule: AutoReviewRule = {
      id: 'r2',
      name: 'Safe changes',
      enabled: true,
      conditions: { maxLinesChanged: 50, excludePatterns: ['*.ts'] },
      action: 'auto-merge'
    }
    const files = [{ path: 'src/main.ts', additions: 1, deletions: 0 }]
    const result = evaluateAutoReviewRules([rule], files)
    expect(result).toBeNull()
  })
})
