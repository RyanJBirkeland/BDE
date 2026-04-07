import { describe, it, expect } from 'vitest'
import { deduplicateCss } from '../css-dedup'

describe('deduplicateCss', () => {
  it('removes exact duplicate rules, keeping last occurrence', () => {
    const css = `
.foo { color: red; }
.bar { color: blue; }
.foo { color: red; }
`.trim()

    const result = deduplicateCss(css)
    const occurrences = (result.deduplicated.match(/\.foo/g) || []).length
    expect(occurrences).toBe(1)
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].selector).toBe('.foo')
    // Last occurrence kept — .bar should appear before .foo in output
    const barIndex = result.deduplicated.indexOf('.bar')
    const fooIndex = result.deduplicated.indexOf('.foo')
    expect(barIndex).toBeLessThan(fooIndex)
  })

  it('returns input unchanged when no duplicates', () => {
    const css = `.foo { color: red; }\n.bar { color: blue; }`
    const result = deduplicateCss(css)
    expect(result.removed).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
    expect(result.deduplicated.replace(/\s+/g, ' ').trim()).toBe(css.replace(/\s+/g, ' ').trim())
  })

  it('treats rules in different @media contexts as distinct', () => {
    const css = `
.foo { color: red; }
@media (max-width: 768px) {
  .foo { color: red; }
}
`.trim()

    const result = deduplicateCss(css)
    expect(result.removed).toHaveLength(0)
    const occurrences = (result.deduplicated.match(/\.foo/g) || []).length
    expect(occurrences).toBe(2)
  })

  it('deduplicates @keyframes by name', () => {
    const css = `
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.spinner { animation: spin 1s linear; }
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`.trim()

    const result = deduplicateCss(css)
    const occurrences = (result.deduplicated.match(/@keyframes spin/g) || []).length
    expect(occurrences).toBe(1)
    expect(result.removed).toHaveLength(1)
    expect(result.removed[0].selector).toBe('spin')
  })

  it('warns on near-duplicates (same selector, different body)', () => {
    const css = `
.foo { color: red; }
.foo { color: blue; }
`.trim()

    const result = deduplicateCss(css)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('.foo')
    // Near-duplicates are not removed — both kept
    const occurrences = (result.deduplicated.match(/\.foo/g) || []).length
    expect(occurrences).toBe(2)
  })

  it('preserves comments', () => {
    const css = `
/* Header styles */
.foo { color: red; }
/* Footer styles */
.bar { color: blue; }
`.trim()

    const result = deduplicateCss(css)
    expect(result.deduplicated).toContain('/* Header styles */')
    expect(result.deduplicated).toContain('/* Footer styles */')
  })

  it('handles empty input', () => {
    const result = deduplicateCss('')
    expect(result.deduplicated).toBe('')
    expect(result.removed).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('normalizes whitespace for comparison', () => {
    const css = `
.foo {
  color: red;
  margin: 0;
}
.foo { color:   red;   margin:    0; }
`.trim()

    const result = deduplicateCss(css)
    const occurrences = (result.deduplicated.match(/\.foo/g) || []).length
    expect(occurrences).toBe(1)
    expect(result.removed).toHaveLength(1)
  })

  it('handles nested @media with duplicates inside', () => {
    const css = `
@media (max-width: 768px) {
  .foo { color: red; }
  .bar { color: blue; }
  .foo { color: red; }
}
`.trim()

    const result = deduplicateCss(css)
    // .foo inside @media is duplicated — one should be removed
    const occurrences = (result.deduplicated.match(/\.foo/g) || []).length
    expect(occurrences).toBe(1)
    expect(result.removed).toHaveLength(1)
  })
})
