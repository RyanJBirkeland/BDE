/**
 * Lightweight spec quality heuristics used by SpecEditor's toolbar hints.
 * Pure functions — no DOM, no state — so they are easy to unit test.
 */

export type SpecLengthStatus = 'too-short' | 'good' | 'warning' | 'danger'

export interface SpecQualityIndicators {
  wordCount: number
  hasFilePaths: boolean
  hasTestSection: boolean
  lengthStatus: SpecLengthStatus
}

/**
 * Detects whether the spec mentions at least one plausible file path.
 * We look for patterns like `src/foo/bar.ts`, `packages/x/...`, bare
 * `foo.ts` filenames, etc. Lightweight — false positives are fine; this is
 * a hint, not a validator.
 */
export function hasFilePaths(spec: string): boolean {
  if (!spec) return false
  // Common source dirs followed by a path segment
  if (/\b(?:src|packages|apps|lib|tests?|spec|docs|scripts|bin)\//i.test(spec)) {
    return true
  }
  // A bare filename with a known extension
  if (
    /\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|scss|md|json|yml|yaml|toml|py|rs|go|sh|html)\b/i.test(
      spec
    )
  ) {
    return true
  }
  return false
}

/**
 * Detects whether the spec mentions tests / verification.
 */
export function hasTestSection(spec: string): boolean {
  if (!spec) return false
  return /(?:^|\n)\s*#{1,6}\s*(?:how to test|testing|tests?|verification|qa)\b/i.test(spec) ||
    /\bnpm\s+test\b/i.test(spec) ||
    /\bhow to test\b/i.test(spec)
}

/**
 * Count words in a spec. Whitespace-delimited — close enough for a hint.
 */
export function countWords(spec: string): number {
  const trimmed = spec.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/**
 * Assess spec length based on BDE agent guidelines:
 * - Ideal: 200-400 words (fast completion, 15-30 min)
 * - Warning: 400-500 words (getting long)
 * - Danger: 500+ words (causes timeouts)
 * - Too short: < 100 words (insufficient detail)
 */
export function assessSpecLength(wordCount: number): SpecLengthStatus {
  if (wordCount < 100) return 'too-short'
  if (wordCount >= 200 && wordCount <= 400) return 'good'
  if (wordCount > 400 && wordCount < 500) return 'warning'
  if (wordCount >= 500) return 'danger'
  // 100-199 words: acceptable but not ideal
  return 'good'
}

export function analyzeSpec(spec: string): SpecQualityIndicators {
  const wordCount = countWords(spec)
  return {
    wordCount,
    hasFilePaths: hasFilePaths(spec),
    hasTestSection: hasTestSection(spec),
    lengthStatus: assessSpecLength(wordCount)
  }
}
