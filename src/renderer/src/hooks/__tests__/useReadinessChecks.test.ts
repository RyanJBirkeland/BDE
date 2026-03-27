import { describe, it, expect } from 'vitest'
import { computeStructuralChecks } from '../useReadinessChecks'

describe('computeStructuralChecks', () => {
  it('fails when title is empty', () => {
    const checks = computeStructuralChecks({ title: '', repo: 'BDE', spec: '' })
    const titleCheck = checks.find((c) => c.id === 'title-present')
    expect(titleCheck?.status).toBe('fail')
  })

  it('passes when title is non-empty', () => {
    const checks = computeStructuralChecks({ title: 'Fix bug', repo: 'BDE', spec: '' })
    const titleCheck = checks.find((c) => c.id === 'title-present')
    expect(titleCheck?.status).toBe('pass')
  })

  it('fails when spec is empty', () => {
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: '' })
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('fail')
  })

  it('warns when spec is very short (1-50 chars)', () => {
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: 'Short spec here' })
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('warn')
  })

  it('passes when spec is >50 chars', () => {
    const longSpec = 'A'.repeat(51)
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: longSpec })
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('pass')
  })

  it('warns when spec has 1 heading', () => {
    const spec = '## Problem\nSome description that is long enough to pass the length check yes'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const specStructure = checks.find((c) => c.id === 'spec-structure')
    expect(specStructure?.status).toBe('warn')
  })

  it('passes when spec has 2+ headings', () => {
    const spec = '## Problem\nDescription\n## Solution\nMore text that is long enough'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const specStructure = checks.find((c) => c.id === 'spec-structure')
    expect(specStructure?.status).toBe('pass')
  })

  it('fails when spec has no headings', () => {
    const spec = 'Just a wall of text without any markdown headings at all and its pretty long'
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec })
    const specStructure = checks.find((c) => c.id === 'spec-structure')
    expect(specStructure?.status).toBe('fail')
  })

  it('always passes repo check when repo is set', () => {
    const checks = computeStructuralChecks({ title: 'Fix', repo: 'BDE', spec: '' })
    const repoCheck = checks.find((c) => c.id === 'repo-selected')
    expect(repoCheck?.status).toBe('pass')
  })
})

describe('computeStructuralChecks with specType', () => {
  it('test type: short spec is warn (advisory) not fail', () => {
    const checks = computeStructuralChecks(
      { title: 'Test auth', repo: 'BDE', spec: 'Run auth tests' },
      'test'
    )
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('warn')
  })

  it('test type: no headings is warn (advisory) not fail', () => {
    const checks = computeStructuralChecks(
      { title: 'Test', repo: 'BDE', spec: 'Run the integration test suite for authentication module' },
      'test'
    )
    const structure = checks.find((c) => c.id === 'spec-structure')
    expect(structure?.status).toBe('warn')
  })

  it('feature type: short spec is fail (required)', () => {
    const checks = computeStructuralChecks(
      { title: 'Add feature', repo: 'BDE', spec: 'Short' },
      'feature'
    )
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('fail')
  })

  it('null specType defaults to feature profile (required)', () => {
    const checks = computeStructuralChecks(
      { title: 'Fix', repo: 'BDE', spec: 'Short' },
      null
    )
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('fail')
  })

  it('refactor type: uses 30-char threshold', () => {
    const spec = 'Refactor the auth module code here'
    const checks = computeStructuralChecks(
      { title: 'Refactor', repo: 'BDE', spec },
      'refactor'
    )
    const specPresent = checks.find((c) => c.id === 'spec-present')
    expect(specPresent?.status).toBe('pass')
  })
})
