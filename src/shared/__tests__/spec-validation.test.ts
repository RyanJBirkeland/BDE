import { describe, it, expect } from 'vitest'
import { validateStructural, MIN_SPEC_LENGTH, MIN_HEADING_COUNT } from '../spec-validation'

describe('validateStructural', () => {
  const validSpec = `${'x'.repeat(60)}\n## Problem\nSomething is broken\n## Solution\nFix it`

  it('returns error when title is empty', () => {
    const result = validateStructural({ title: '', repo: 'bde', spec: validSpec })
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining('title is required'))
  })

  it('returns error when title is null', () => {
    const result = validateStructural({ title: null, repo: 'bde', spec: validSpec })
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining('title is required'))
  })

  it('returns error when repo is empty', () => {
    const result = validateStructural({ title: 'Fix bug', repo: '', spec: validSpec })
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining('repo is required'))
  })

  it('returns error when repo is null', () => {
    const result = validateStructural({ title: 'Fix bug', repo: null, spec: validSpec })
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining('repo is required'))
  })

  it('returns error when spec is null (non-backlog)', () => {
    const result = validateStructural({ title: 'Fix bug', repo: 'bde', spec: null })
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining('spec is required'))
  })

  it('returns error when spec is too short', () => {
    const result = validateStructural({
      title: 'Fix bug',
      repo: 'bde',
      spec: 'Short spec with ## A\n## B'
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining(`minimum ${MIN_SPEC_LENGTH}`))
  })

  it('returns error when spec has no ## headings', () => {
    const result = validateStructural({
      title: 'Fix bug',
      repo: 'bde',
      spec: 'x'.repeat(100)
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining(`at least ${MIN_HEADING_COUNT} markdown sections`)
    )
  })

  it('returns error when spec has only 1 heading', () => {
    const result = validateStructural({
      title: 'Fix bug',
      repo: 'bde',
      spec: `${'x'.repeat(60)}\n## Problem\nSomething is broken`
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(
      expect.stringContaining(`at least ${MIN_HEADING_COUNT} markdown sections`)
    )
  })

  it('returns valid when spec has 2+ headings and sufficient length', () => {
    const result = validateStructural({
      title: 'Fix bug',
      repo: 'bde',
      spec: validSpec
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('returns valid for backlog status with no spec', () => {
    const result = validateStructural({
      title: 'Fix bug',
      repo: 'bde',
      spec: null,
      status: 'backlog'
    })
    expect(result.valid).toBe(true)
  })

  it('returns error for backlog status with no title', () => {
    const result = validateStructural({
      title: '',
      repo: 'bde',
      spec: null,
      status: 'backlog'
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(expect.stringContaining('title is required'))
  })

  it('produces descriptive error messages (not just "invalid")', () => {
    const result = validateStructural({ title: '', repo: '', spec: '' })
    for (const msg of result.errors) {
      expect(msg.length).toBeGreaterThan(10)
    }
  })
})
