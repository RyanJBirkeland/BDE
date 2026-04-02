import { describe, it, expect } from 'vitest'
import {
  validateStructural,
  MIN_SPEC_LENGTH,
  MIN_HEADING_COUNT,
  getValidationProfile
} from '../spec-validation'

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

describe('getValidationProfile', () => {
  it('returns feature profile by default (null specType)', () => {
    const profile = getValidationProfile(null)
    expect(profile.specPresent.behavior).toBe('required')
    expect(profile.specPresent.threshold).toBe(50)
    expect(profile.specStructure.behavior).toBe('required')
  })

  it('returns feature profile for "feature"', () => {
    const profile = getValidationProfile('feature')
    expect(profile.specPresent.behavior).toBe('required')
    expect(profile.specPresent.threshold).toBe(50)
  })

  it('returns relaxed profile for "test"', () => {
    const profile = getValidationProfile('test')
    expect(profile.specPresent.behavior).toBe('advisory')
    expect(profile.specPresent.threshold).toBe(20)
    expect(profile.specStructure.behavior).toBe('advisory')
    expect(profile.filesExist.behavior).toBe('skip')
  })

  it('returns relaxed profile for "refactor"', () => {
    const profile = getValidationProfile('refactor')
    expect(profile.specPresent.threshold).toBe(30)
    expect(profile.specStructure.behavior).toBe('advisory')
    expect(profile.scope.behavior).toBe('advisory')
  })

  it('returns relaxed profile for "audit"', () => {
    const profile = getValidationProfile('audit')
    expect(profile.specPresent.behavior).toBe('advisory')
    expect(profile.specStructure.behavior).toBe('advisory')
    expect(profile.filesExist.behavior).toBe('skip')
  })

  it('performance and ux alias to feature profile', () => {
    const perf = getValidationProfile('performance')
    const feat = getValidationProfile('feature')
    expect(perf).toEqual(feat)
  })
})

describe('validateStructural with specType', () => {
  it('enforces 50-char min for feature', () => {
    const result = validateStructural({
      title: 'Fix',
      repo: 'BDE',
      spec: 'Short',
      status: 'queued'
    })
    expect(result.valid).toBe(false)
  })

  it('uses 20-char threshold for test type', () => {
    const result = validateStructural({
      title: 'Fix',
      repo: 'BDE',
      spec: 'Run integration tests for auth',
      status: 'queued',
      specType: 'test'
    })
    expect(result.valid).toBe(true)
  })

  it('still requires title and repo for all types', () => {
    const result = validateStructural({ title: '', repo: '', spec: 'x', specType: 'test' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('title is required')
  })

  it('treats advisory failures as warnings not errors', () => {
    const result = validateStructural({
      title: 'Test',
      repo: 'BDE',
      spec: 'Run tests',
      status: 'queued',
      specType: 'test'
    })
    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
