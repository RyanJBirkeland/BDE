import { describe, it, expect } from 'vitest'
import { buildSyntheticDiff } from '../spec-diff'

describe('buildSyntheticDiff', () => {
  it('produces a valid unified diff header', () => {
    const result = buildSyntheticDiff('spec.md', 'old line', 'new line')
    expect(result).toContain('diff --git a/spec.md b/spec.md')
    expect(result).toContain('--- a/spec.md')
    expect(result).toContain('+++ b/spec.md')
    expect(result).toContain('@@ -1,1 +1,1 @@')
  })

  it('marks old lines with - and new lines with +', () => {
    const result = buildSyntheticDiff('spec.md', 'removed', 'added')
    expect(result).toContain('-removed')
    expect(result).toContain('+added')
  })

  it('handles empty old string (all additions)', () => {
    const result = buildSyntheticDiff('spec.md', '', 'new content')
    expect(result).toContain('-\n') // one empty del line
    expect(result).toContain('+new content')
  })

  it('handles multi-line strings', () => {
    const old = '## Goal\nBuild auth'
    const next = '## Goal\nBuild OAuth2 auth\nwith refresh tokens'
    const result = buildSyntheticDiff('spec.md', old, next)
    expect(result).toContain('-## Goal')
    expect(result).toContain('+## Goal')
    expect(result).toContain('+with refresh tokens')
  })
})
