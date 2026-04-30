import { describe, it, expect } from 'vitest'
import { buildQuickSpecPrompt, getTemplateScaffold } from '../spec-template-service'

describe('getTemplateScaffold', () => {
  it('returns the bugfix scaffold for "bugfix" hint', () => {
    const scaffold = getTemplateScaffold('bugfix')
    expect(scaffold).toContain('## Bug Description')
    expect(scaffold).toContain('## Root Cause')
  })

  it('returns the feature scaffold for "feature" hint', () => {
    const scaffold = getTemplateScaffold('feature')
    expect(scaffold).toContain('## Problem')
    expect(scaffold).toContain('## Solution')
  })

  it('falls back to the feature scaffold for unknown hint', () => {
    const scaffold = getTemplateScaffold('unknown-type')
    expect(scaffold).toContain('## Problem')
  })

  it('returns a non-empty string for every built-in hint', () => {
    const hints = ['bugfix', 'feature', 'refactor', 'test', 'performance', 'ux', 'audit', 'infra']
    for (const hint of hints) {
      expect(getTemplateScaffold(hint).length).toBeGreaterThan(0)
    }
  })
})

describe('buildQuickSpecPrompt', () => {
  it('includes the task title', () => {
    const prompt = buildQuickSpecPrompt('Fix the login', 'fleet', 'bugfix', '## Bug Description')
    expect(prompt).toContain('Fix the login')
  })

  it('includes the repo name', () => {
    const prompt = buildQuickSpecPrompt('Task', 'myrepo', 'feature', '')
    expect(prompt).toContain('myrepo')
  })

  it('includes the scaffold when provided', () => {
    const scaffold = '## Approach\n## Files'
    const prompt = buildQuickSpecPrompt('Task', 'repo', 'feature', scaffold)
    expect(prompt).toContain('## Approach')
  })

  it('falls back to default structure when scaffold is empty string', () => {
    const prompt = buildQuickSpecPrompt('Task', 'repo', 'feature', '')
    expect(prompt).toContain('Out of Scope')
  })

  it('instructs the model to output only spec markdown with no preamble', () => {
    const prompt = buildQuickSpecPrompt('Task', 'repo', 'feature', '')
    expect(prompt).toContain('Output ONLY the spec markdown')
  })
})
